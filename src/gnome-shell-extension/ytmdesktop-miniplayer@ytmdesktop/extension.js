import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';

const SERVICE = 'io.github.ytmdesktop.MiniPlayer';
const OBJECT_PATH = '/io/github/ytmdesktop/MiniPlayer';
const SEARCH_DEBOUNCE_MS = 900;
const LAYOUTS = ['small', 'medium', 'large'];
const LAYOUT_SIZES = {small: 48, medium: 96, large: 128};
const SEARCH_ORDERS = ['music', 'video'];

const DBUS_XML = `
<node>
  <interface name="${SERVICE}">
    <method name="GetState">
      <arg type="s" name="stateJson" direction="out"/>
    </method>
    <method name="Command">
      <arg type="s" name="command" direction="in"/>
      <arg type="d" name="value" direction="in"/>
    </method>
    <method name="ToggleMainWindow"/>
    <method name="OpenSettings"/>
    <method name="Quit"/>
    <method name="Search">
      <arg type="s" name="query" direction="in"/>
    </method>
    <method name="PlayResult">
      <arg type="s" name="videoId" direction="in"/>
      <arg type="s" name="action" direction="in"/>
    </method>
    <signal name="StateChanged">
      <arg type="s" name="stateJson"/>
    </signal>
    <signal name="SearchResultsChanged">
      <arg type="s" name="resultsJson"/>
    </signal>
  </interface>
</node>`;

const MiniPlayerProxy = Gio.DBusProxy.makeProxyWrapper(DBUS_XML);

function formatTime(seconds) {
    const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    const minutes = Math.floor(safeSeconds / 60);
    const remainder = Math.floor(safeSeconds % 60);
    return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

function addScrollChild(scrollView, actor) {
    if (scrollView.add_actor)
        scrollView.add_actor(actor);
    else
        scrollView.add_child(actor);
}

function layoutPath() {
    return GLib.build_filenamev([GLib.get_user_config_dir(), 'ytmdesktop-miniplayer', 'layout']);
}

function readLayout() {
    try {
        const file = Gio.File.new_for_path(layoutPath());
        const [, contents] = file.load_contents(null);
        const text = new TextDecoder().decode(contents).trim();
        if (LAYOUTS.includes(text))
            return text;
    } catch (error) {}
    return 'medium';
}

function writeLayout(size) {
    const dir = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_config_dir(), 'ytmdesktop-miniplayer']));
    try {
        dir.make_directory_with_parents(null);
    } catch (error) {}
    dir.get_child('layout').replace_contents(new TextEncoder().encode(size), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}

function searchOrderPath() {
    return GLib.build_filenamev([GLib.get_user_config_dir(), 'ytmdesktop-miniplayer', 'search-order']);
}

function readSearchOrder() {
    try {
        const file = Gio.File.new_for_path(searchOrderPath());
        const [, contents] = file.load_contents(null);
        const text = new TextDecoder().decode(contents).trim();
        if (SEARCH_ORDERS.includes(text))
            return text;
    } catch (error) {}
    return 'music';
}

function writeSearchOrder(order) {
    const dir = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_config_dir(), 'ytmdesktop-miniplayer']));
    try {
        dir.make_directory_with_parents(null);
    } catch (error) {}
    try {
        dir.get_child('search-order').replace_contents(new TextEncoder().encode(order), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    } catch (error) {
        console.error(`YTMDesktop search order save failed: ${error.message}`);
    }
}

const MiniPlayerIndicator = GObject.registerClass(
class MiniPlayerIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'YTMDesktop Mini Player');
        this._extensionPath = extension.path;

        this._state = null;
        this._searchState = null;
        this._localProgress = 0;
        this._dragging = false;
        this._seekTarget = null;
        this._seekDeadline = 0;
        this._artUrl = null;
        this._artPath = null;
        this._artLoadId = 0;
        this._searchTimer = 0;
        this._lastSearchQuery = '';
        this._searchOrder = readSearchOrder();
        writeSearchOrder(this._searchOrder);
        this._layout = readLayout();
        this._volumeDragging = false;
        this._likeOverride = null;
        this._likeOverrideTimer = 0;

        this.add_style_class_name('ytmd-tray-button');
        const trayIcon = new St.Icon({
            gicon: new Gio.FileIcon({
                file: Gio.File.new_for_path(`${this._extensionPath}/icons/ytmd-panel.svg`),
            }),
            style_class: 'ytmd-tray-icon',
            icon_size: 16,
            x_expand: false,
            y_expand: false,
        });
        trayIcon.set_size(16, 16);
        this.add_child(trayIcon);

        this._buildMenu();
        this.visible = false;

        this._proxy = new MiniPlayerProxy(
            Gio.DBus.session,
            SERVICE,
            OBJECT_PATH,
            (proxy, error) => {
                if (error) {
                    console.error(`YTMDesktop mini-player proxy failed: ${error.message}`);
                    return;
                }

                this._ownerChangedId = proxy.connect('notify::g-name-owner', () => this._syncOwner());
                this._stateChangedId = proxy.connectSignal('StateChanged', (_proxy, _sender, [stateJson]) => this._applyStateJson(stateJson));
                this._searchChangedId = proxy.connectSignal('SearchResultsChanged', (_proxy, _sender, [resultsJson]) => this._applySearchJson(resultsJson));
                this._syncOwner();
            },
            null,
            Gio.DBusProxyFlags.DO_NOT_AUTO_START
        );

        this._menuOpenId = this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._requestState();
        });
        this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            if (this._state?.status === 'playing' && this._state?.track && !this._dragging) {
                const duration = this._duration();
                this._localProgress = Math.min(this._localProgress + 0.25, duration || Number.POSITIVE_INFINITY);
                this._updateProgress();
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _buildMenu() {
        this.menu.box.add_style_class_name('ytmd-menu');

        const searchWrap = new St.BoxLayout({vertical: true, style_class: 'ytmd-search-wrap', x_expand: true});
        this._searchWrap = searchWrap;
        this.menu.box.add_child(searchWrap);
        searchWrap.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape)
                return Clutter.EVENT_PROPAGATE;
            return Clutter.EVENT_STOP;
        });

        this._searchEntry = new St.Entry({
            style_class: 'ytmd-search-entry',
            hint_text: 'Search',
            can_focus: true,
            track_hover: true,
            x_expand: true,
        });
        this._searchEntry.set_primary_icon(new St.Icon({
            gicon: this._fileIcon('search.svg'),
            icon_size: 16,
        }));
        const searchText = this._searchEntry.get_clutter_text();
        searchText.connect('activate', () => {
            this._cancelSearchTimer();
            this._runSearch();
        });
        searchText.connect('text-changed', () => this._onSearchTextChanged());
        try {
            searchText.connect('preedit-changed', () => this._onSearchTextChanged());
        } catch (error) {}
        searchWrap.add_child(this._searchEntry);

        this._resultsBox = new St.BoxLayout({vertical: true, style_class: 'ytmd-results-box', x_expand: true});
        this._resultsHeader = new St.BoxLayout({style_class: 'ytmd-results-header', x_expand: true});
        this._resultsHeader.add_child(new St.Label({text: 'Results', style_class: 'ytmd-results-label', x_expand: true}));
        const orderToggle = new St.BoxLayout({style_class: 'ytmd-order-toggle'});
        this._musicFirstButton = this._orderButton('Music ↑', 'Music results first', 'music');
        this._videoFirstButton = this._orderButton('Video ↑', 'Video results first', 'video');
        orderToggle.add_child(this._musicFirstButton);
        orderToggle.add_child(this._videoFirstButton);
        this._resultsHeader.add_child(orderToggle);
        this._resultsStatus = new St.Label({text: '', style_class: 'ytmd-results-status'});
        this._resultsStatus.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._resultsList = new St.BoxLayout({vertical: true, style_class: 'ytmd-results', x_expand: true});
        this._resultsScroll = new St.ScrollView({
            style_class: 'ytmd-results-scroll',
            overlay_scrollbars: true,
            x_expand: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
        });
        addScrollChild(this._resultsScroll, this._resultsList);
        this._resultsBox.add_child(this._resultsHeader);
        this._resultsBox.add_child(this._resultsStatus);
        this._resultsBox.add_child(this._resultsScroll);
        this._resultsBox.visible = false;
        searchWrap.add_child(this._resultsBox);

        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this.menu.addMenuItem(item);
        const root = new St.BoxLayout({vertical: true, style_class: 'ytmd-popup'});
        item.add_child(root);

        const playerRow = new St.BoxLayout({vertical: false, style_class: 'ytmd-player-row'});
        root.add_child(playerRow);

        this._artWrap = new St.Bin({
            style_class: 'ytmd-art-wrap',
            x_expand: false,
            y_expand: false,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START,
        });
        this._art = new St.Widget({
            style_class: 'ytmd-art',
            x_expand: false,
            y_expand: false,
        });
        this._artPlaceholder = new St.Icon({
            icon_name: 'audio-x-generic-symbolic',
            icon_size: 20,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._art.add_child(this._artPlaceholder);
        this._artWrap.set_child(this._art);
        playerRow.add_child(this._artWrap);

        const details = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'ytmd-details'});
        playerRow.add_child(details);

        this._title = new St.Label({text: 'Nothing playing', style_class: 'ytmd-title', x_expand: true});
        this._title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._artist = new St.Label({text: 'Open YouTube Music to start playing', style_class: 'ytmd-artist', x_expand: true});
        this._artist.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        details.add_child(this._title);
        details.add_child(this._artist);

        this._seekBox = new St.BoxLayout({vertical: true, style_class: 'ytmd-seek-box', x_expand: true});
        this._slider = new Slider.Slider(0);
        this._slider.x_expand = true;
        this._slider.style_class = 'slider ytmd-slider';
        this._slider.connect('drag-begin', () => {
            this._dragging = true;
        });
        this._slider.connect('drag-end', () => {
            this._dragging = false;
            const duration = this._duration();
            if (duration > 0) {
                const target = this._slider.value * duration;
                this._localProgress = target;
                this._seekTarget = target;
                this._seekDeadline = Date.now() + 2000;
                this._command('seekTo', target);
            }
        });
        this._seekBox.add_child(this._slider);

        const times = new St.BoxLayout({style_class: 'ytmd-times'});
        this._currentTime = new St.Label({text: '0:00'});
        this._totalTime = new St.Label({text: '0:00', x_expand: true, x_align: Clutter.ActorAlign.END});
        times.add_child(this._currentTime);
        times.add_child(this._totalTime);
        this._seekBox.add_child(times);
        details.add_child(this._seekBox);

        this._miniProgressTrack = new St.BoxLayout({style_class: 'ytmd-mini-progress-track', x_expand: true});
        this._miniProgress = new St.Widget({style_class: 'ytmd-mini-progress-fill'});
        this._miniProgressTrack.add_child(this._miniProgress);
        details.add_child(this._miniProgressTrack);

        const controls = new St.BoxLayout({style_class: 'ytmd-controls', x_align: Clutter.ActorAlign.CENTER});
        this._previousButton = this._iconButton('previous.svg', 'Previous', () => this._command('previous'));
        this._playButton = this._iconButton('play-dark.svg', 'Play', () => this._command('playPause'), 'ytmd-play-button');
        this._nextButton = this._iconButton('next.svg', 'Next', () => this._command('next'));
        this._likeButton = this._iconButton('thumbs-up.svg', 'Like', () => this._toggleLike(), 'ytmd-like-button');
        this._dislikeButton = this._iconButton('thumbs-down.svg', 'Dislike', () => this._toggleDislike());
        this._mixButton = this._iconButton('mix-symbolic.png', 'Start mix', () => this._command('startMix'));
        this._repeatButton = this._iconButton('repeat.svg', 'Repeat', () => this._cycleRepeat());
        this._shuffleButton = this._iconButton('shuffle.svg', 'Shuffle', () => this._command('shuffle'));
        controls.add_child(this._previousButton);
        controls.add_child(this._playButton);
        controls.add_child(this._nextButton);
        controls.add_child(this._likeButton);
        controls.add_child(this._dislikeButton);
        controls.add_child(this._mixButton);
        controls.add_child(this._repeatButton);
        controls.add_child(this._shuffleButton);
        details.add_child(controls);

        this._volumeRow = new St.BoxLayout({style_class: 'ytmd-volume-row', x_expand: true});
        this._muteButton = this._iconButton('volume-high.svg', 'Mute', () => this._command('mute'), 'ytmd-volume-icon');
        this._volumeSlider = new Slider.Slider(0);
        this._volumeSlider.x_expand = true;
        this._volumeSlider.style_class = 'slider ytmd-volume-slider';
        this._volumeDragging = false;
        this._lastSentVolume = -1;
        this._volumeSlider.connect('drag-begin', () => {
            this._volumeDragging = true;
        });
        this._volumeSlider.connect('notify::value', () => {
            if (!this._volumeDragging)
                return;
            const volume = Math.round(this._volumeSlider.value * 100);
            if (volume === this._lastSentVolume)
                return;
            this._lastSentVolume = volume;
            this._command('setVolume', volume);
        });
        this._volumeSlider.connect('drag-end', () => {
            this._volumeDragging = false;
            const volume = Math.round(this._volumeSlider.value * 100);
            this._lastSentVolume = volume;
            this._command('setVolume', volume);
        });
        this._volumeRow.add_child(this._muteButton);
        this._volumeRow.add_child(this._volumeSlider);
        root.add_child(this._volumeRow);

        this._openAppButton = new St.Button({
            label: 'Open YTMusic',
            style_class: 'ytmd-open-button',
            can_focus: true,
            reactive: true,
            track_hover: true,
            visible: false,
        });
        this._openAppButton.connect('clicked', () => this._call('ToggleMainWindow'));
        details.add_child(this._openAppButton);

        const footer = new St.BoxLayout({style_class: 'ytmd-footer', x_align: Clutter.ActorAlign.END});
        footer.add_child(this._iconButton('window.svg', 'Show or hide window', () => this._call('ToggleMainWindow')));
        this._sizeButton = this._iconButton('size.svg', 'Size: Medium', () => this._cycleLayout());
        footer.add_child(this._sizeButton);
        this._settingsButton = this._iconButton('settings.svg', 'Settings', () => this._call('OpenSettings'));
        footer.add_child(this._settingsButton);
        footer.add_child(this._iconButton('quit.svg', 'Quit', () => this._call('Quit'), 'ytmd-quit-button'));
        root.add_child(footer);
        this._applyLayout();
    }

    _applyLayout() {
        const size = this._layout;
        for (const name of LAYOUTS)
            this.menu.box.remove_style_class_name(`ytmd-size-${name}`);
        this.menu.box.add_style_class_name(`ytmd-size-${size}`);

        const artSize = LAYOUT_SIZES[size];
        this._artWrap.set_size(artSize, artSize);
        this._artWrap.set_width(artSize);
        this._artWrap.set_height(artSize);
        this._art.set_size(artSize, artSize);
        this._art.set_width(artSize);
        this._art.set_height(artSize);
        this._art.set_clip_to_allocation(true);
        this._artPlaceholder.icon_size = Math.max(16, Math.floor(artSize / 3));
        const artUrl = this._artUrl;
        this._artUrl = null;
        this._setArtwork(artUrl);

        this._searchWrap.visible = size !== 'small';
        this._seekBox.visible = size !== 'small';
        this._miniProgressTrack.visible = size === 'small';
        this._dislikeButton.visible = size !== 'small';
        this._repeatButton.visible = size === 'large';
        this._shuffleButton.visible = size === 'large';
        this._volumeRow.visible = true;
        this._settingsButton.visible = size !== 'small';
        if (size === 'small')
            this._resultsBox.visible = false;
        else
            this._renderSearch();

        const sizeLabel = size.charAt(0).toUpperCase() + size.slice(1);
        this._sizeButton.accessible_name = `Size: ${sizeLabel}`;
        writeLayout(size);
        this._updateProgress();
    }

    _cycleLayout() {
        const index = LAYOUTS.indexOf(this._layout);
        this._layout = LAYOUTS[(index + 1) % LAYOUTS.length];
        this._applyLayout();
    }

    _cycleRepeat() {
        const order = ['none', 'all', 'one'];
        const current = this._state?.repeatMode || 'none';
        const next = (order.indexOf(current) + 1) % order.length;
        this._command('repeatMode', next);
    }

    _fileIcon(fileName) {
        return new Gio.FileIcon({file: Gio.File.new_for_path(`${this._extensionPath}/icons/${fileName}`)});
    }

    _setButtonIcon(button, iconName) {
        if (button._ytmdIconName === iconName && button.get_child())
            return;
        button._ytmdIconName = iconName;
        const icon = new St.Icon({icon_size: 22});
        if (iconName.endsWith('.svg') || iconName.endsWith('.png'))
            icon.gicon = this._fileIcon(iconName);
        else
            icon.icon_name = iconName;
        button.set_child(icon);
    }

    _iconButton(iconName, accessibleName, callback, styleClass = '') {
        const button = new St.Button({
            style_class: `ytmd-icon-button ${styleClass}`,
            accessible_name: accessibleName,
            can_focus: true,
            reactive: true,
            track_hover: true,
        });
        const icon = new St.Icon({icon_size: 22});
        button.set_child(icon);
        this._setButtonIcon(button, iconName);
        button.connect('clicked', callback);
        return button;
    }

    _textButton(label, accessibleName, callback) {
        const button = new St.Button({
            label,
            style_class: 'ytmd-result-action',
            accessible_name: accessibleName,
            can_focus: true,
            reactive: true,
            track_hover: true,
        });
        button.connect('clicked', callback);
        return button;
    }

    _orderButton(label, accessibleName, order) {
        const button = new St.Button({
            label,
            style_class: 'ytmd-order-button',
            accessible_name: accessibleName,
            can_focus: true,
            reactive: true,
            track_hover: true,
        });
        button.connect('clicked', () => this._setSearchOrder(order));
        return button;
    }

    _setSearchOrder(order) {
        if (!SEARCH_ORDERS.includes(order) || order === this._searchOrder)
            return;
        this._searchOrder = order;
        writeSearchOrder(order);
        this._renderSearch();
    }

    _orderedSearchResults(results) {
        const ranks = this._searchOrder === 'video'
            ? {video: 0, music: 1, unknown: 2}
            : {music: 0, video: 1, unknown: 2};
        return results
            .map((result, index) => ({result, index}))
            .sort((left, right) => {
                const leftRank = ranks[left.result.kind] ?? ranks.unknown;
                const rightRank = ranks[right.result.kind] ?? ranks.unknown;
                return leftRank - rightRank || left.index - right.index;
            })
            .map(({result}) => result);
    }

    _isComposing() {
        const text = this._searchEntry.get_clutter_text();
        try {
            if (text.has_preedit)
                return Boolean(text.has_preedit());
            if (text.get_preedit_string) {
                const preedit = text.get_preedit_string();
                const value = Array.isArray(preedit) ? preedit[0] : preedit;
                return Boolean(value);
            }
        } catch (error) {}
        return false;
    }

    _onSearchTextChanged() {
        this._cancelSearchTimer();
        if (!this._searchEntry.get_text().trim()) {
            this._clearSearch();
            return;
        }
        if (this._isComposing())
            return;
        this._searchTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SEARCH_DEBOUNCE_MS, () => {
            this._searchTimer = 0;
            if (this._isComposing())
                return GLib.SOURCE_REMOVE;
            this._runSearch();
            return GLib.SOURCE_REMOVE;
        });
    }

    _clearSearch() {
        this._lastSearchQuery = '';
        this._searchState = null;
        this._renderSearch();
        this._call('Search', '');
    }

    _cancelSearchTimer() {
        if (this._searchTimer) {
            GLib.source_remove(this._searchTimer);
            this._searchTimer = 0;
        }
    }

    _runSearch() {
        const query = this._searchEntry.get_text().trim();
        if (!query) {
            this._clearSearch();
            return;
        }
        if (query === this._lastSearchQuery && this._searchState?.status === 'loading')
            return;

        this._lastSearchQuery = query;
        this._call('Search', query);
    }

    _applySearchJson(resultsJson) {
        let nextState;
        try {
            nextState = JSON.parse(resultsJson);
        } catch (error) {
            console.error(`YTMDesktop search parse failed: ${error.message}`);
            return;
        }

        const currentQuery = this._searchEntry.get_text().trim();
        if (nextState.status !== 'idle' && nextState.query !== currentQuery)
            return;

        this._searchState = nextState;
        this._renderSearch();
    }

    _renderSearch() {
        if (this._layout === 'small') {
            this._resultsBox.visible = false;
            return;
        }

        const children = this._resultsList.get_children();
        for (const child of children)
            child.destroy();

        const search = this._searchState;
        if (!search || search.status === 'idle') {
            this._resultsBox.visible = false;
            return;
        }

        this._resultsBox.visible = true;
        this._resultsHeader.visible = false;
        if (search.status === 'loading') {
            this._resultsStatus.text = 'Searching…';
            this._resultsStatus.visible = true;
            this._resultsScroll.visible = false;
            return;
        }

        if (search.status === 'error' || !search.results?.length) {
            this._resultsStatus.text = search.message || 'No songs found';
            this._resultsStatus.visible = true;
            this._resultsScroll.visible = false;
            return;
        }

        this._resultsStatus.visible = false;
        this._resultsHeader.visible = true;
        this._resultsScroll.visible = true;
        this._musicFirstButton[this._searchOrder === 'music' ? 'add_style_class_name' : 'remove_style_class_name']('ytmd-order-button-selected');
        this._videoFirstButton[this._searchOrder === 'video' ? 'add_style_class_name' : 'remove_style_class_name']('ytmd-order-button-selected');
        for (const result of this._orderedSearchResults(search.results))
            this._resultsList.add_child(this._createResultRow(result));
    }

    _createResultRow(result) {
        const row = new St.BoxLayout({style_class: 'ytmd-result-row', x_expand: true});
        const art = new St.Icon({
            icon_name: 'audio-x-generic-symbolic',
            icon_size: 40,
            style_class: 'ytmd-result-art',
        });
        if (result.artworkUrl) {
            try {
                art.icon_name = null;
                art.gicon = new Gio.FileIcon({file: Gio.File.new_for_uri(result.artworkUrl)});
            } catch (error) {
                console.error(`YTMDesktop artwork failed: ${error.message}`);
            }
        }

        const details = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'ytmd-result-details'});
        const title = new St.Label({text: result.title || 'Unknown title', style_class: 'ytmd-result-title', x_expand: true});
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        const subtitle = new St.Label({
            text: [result.artist, result.duration].filter(Boolean).join(' • ') || 'Unknown artist',
            style_class: 'ytmd-result-artist',
            x_expand: true,
        });
        subtitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        details.add_child(title);
        details.add_child(subtitle);

        const actions = new St.BoxLayout({style_class: 'ytmd-result-actions', y_align: Clutter.ActorAlign.CENTER});
        actions.add_child(this._iconButton('play.svg', 'Play now', () => this._call('PlayResult', result.id, 'now'), 'ytmd-result-action'));
        actions.add_child(this._iconButton('queue-next.svg', 'Play next', () => this._call('PlayResult', result.id, 'next'), 'ytmd-result-action'));

        row.add_child(art);
        row.add_child(details);
        row.add_child(actions);
        return row;
    }

    _syncOwner() {
        const running = Boolean(this._proxy?.g_name_owner);
        this.visible = running;
        if (running) {
            this._requestState();
        } else {
            this._cancelSearchTimer();
            this._searchState = null;
            this._lastSearchQuery = '';
            this._renderSearch();
            this.menu.close();
        }
    }

    _requestState() {
        if (!this._proxy?.g_name_owner)
            return;

        this._proxy.GetStateRemote((result, error) => {
            if (error) {
                console.error(`YTMDesktop GetState failed: ${error.message}`);
                return;
            }
            this._applyStateJson(result[0]);
        });
    }

    _applyStateJson(stateJson) {
        let nextState;
        try {
            nextState = JSON.parse(stateJson);
        } catch (error) {
            console.error(`YTMDesktop state parse failed: ${error.message}`);
            return;
        }

        const incomingProgress = nextState?.progressSeconds ?? 0;
        const trackChanged = this._state?.track?.id !== nextState?.track?.id;
        const wasPlaying = this._state?.status === 'playing';
        const duration = this._state?.track?.durationSeconds ?? 0;
        const incomingLike = nextState?.likeStatus || nextState?.track?.likeStatus;
        if (trackChanged)
            this._clearLikeOverride();
        else if (this._likeOverride && incomingLike === this._likeOverride)
            this._clearLikeOverride();
        this._state = nextState;
        if (!this._dragging) {
            if (trackChanged) {
                this._seekTarget = null;
                this._localProgress = incomingProgress;
            } else if (this._seekTarget !== null && Date.now() < this._seekDeadline) {
                if (Math.abs(incomingProgress - this._seekTarget) <= 1.5) {
                    this._seekTarget = null;
                    this._localProgress = incomingProgress;
                }
            } else if (wasPlaying && nextState?.status === 'playing' && duration > 0 && this._localProgress > duration - 2 && incomingProgress < 1.5) {
                // end-of-track glitch: keep local until the next song id arrives
            } else if (wasPlaying && nextState?.status === 'playing') {
                const delta = incomingProgress - this._localProgress;
                if (delta > 0.35 && delta <= 2.5)
                    this._localProgress = incomingProgress;
                else if (delta < -1.25 || delta > 2.5)
                    this._localProgress = incomingProgress;
            } else {
                this._seekTarget = null;
                this._localProgress = incomingProgress;
            }
        }
        this._updateUi();
    }

    _updateUi() {
        const track = this._state?.track ?? null;
        const playing = this._state?.status === 'playing';
        const needsMainApp = this._state?.status === 'needs-main-app';

        this._title.text = track?.title || 'Nothing playing';
        this._artist.text = track?.artist || this._state?.message || 'Open YouTube Music to start playing';
        this._setArtwork(track?.artworkUrl ?? null);

        this._setButtonIcon(this._playButton, playing ? 'pause-dark.svg' : 'play-dark.svg');
        this._playButton.accessible_name = playing ? 'Pause' : 'Play';
        this._setButtonEnabled(this._previousButton, Boolean(this._state?.canPrevious));
        this._setButtonEnabled(this._playButton, Boolean(this._state?.canPlay));
        this._setButtonEnabled(this._nextButton, Boolean(this._state?.canNext));

        this._slider.reactive = Boolean(track) && this._duration() > 0;
        this._openAppButton.visible = needsMainApp && this._layout !== 'small';
        this._updateLikeButtons();
        this._updateRepeatButton();
        this._updateVolume();
        this._updateProgress();
    }

    _currentLikeStatus() {
        const status = this._likeOverride || this._state?.likeStatus || this._state?.track?.likeStatus || 'indifferent';
        return String(status).toLowerCase();
    }

    _clearLikeOverride() {
        this._likeOverride = null;
        if (this._likeOverrideTimer) {
            GLib.source_remove(this._likeOverrideTimer);
            this._likeOverrideTimer = 0;
        }
    }

    _setLikeOverride(status) {
        this._likeOverride = status;
        if (this._likeOverrideTimer)
            GLib.source_remove(this._likeOverrideTimer);
        this._likeOverrideTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            this._likeOverrideTimer = 0;
            this._likeOverride = null;
            this._updateLikeButtons();
            return GLib.SOURCE_REMOVE;
        });
        this._updateLikeButtons();
    }

    _toggleLike() {
        this._setLikeOverride(this._currentLikeStatus() === 'like' ? 'indifferent' : 'like');
        this._command('toggleLike');
    }

    _toggleDislike() {
        this._setLikeOverride(this._currentLikeStatus() === 'dislike' ? 'indifferent' : 'dislike');
        this._command('toggleDislike');
    }

    _updateLikeButtons() {
        const likeStatus = this._currentLikeStatus();
        const liked = likeStatus === 'like';
        const disliked = likeStatus === 'dislike';
        this._setButtonIcon(this._likeButton, liked ? 'thumbs-up-filled.svg' : 'thumbs-up.svg');
        this._setButtonIcon(this._dislikeButton, disliked ? 'thumbs-down-filled.svg' : 'thumbs-down.svg');
        this._likeButton.accessible_name = liked ? 'Unlike' : 'Like';
        this._dislikeButton.accessible_name = disliked ? 'Remove dislike' : 'Dislike';
        this._likeButton[liked ? 'add_style_class_name' : 'remove_style_class_name']('ytmd-like-on');
        this._dislikeButton[disliked ? 'add_style_class_name' : 'remove_style_class_name']('ytmd-dislike-on');
    }

    _updateRepeatButton() {
        const mode = this._state?.repeatMode || 'none';
        this._setButtonIcon(this._repeatButton, mode === 'one' ? 'repeat-one.svg' : 'repeat.svg');
        this._repeatButton.opacity = mode === 'none' ? 120 : 255;
        this._repeatButton.accessible_name = `Repeat: ${mode}`;
    }

    _updateVolume() {
        if (this._volumeDragging)
            return;
        const muted = Boolean(this._state?.muted);
        const volume = this._state?.volume ?? 0;
        const iconName = muted || volume === 0
            ? 'volume-muted.svg'
            : volume < 40
                ? 'volume-low.svg'
                : 'volume-high.svg';
        this._setButtonIcon(this._muteButton, iconName);
        this._volumeSlider.value = muted ? 0 : Math.max(0, Math.min(1, volume / 100));
    }

    _setButtonEnabled(button, enabled) {
        button.reactive = enabled;
        button.can_focus = enabled;
        button.opacity = enabled ? 255 : 90;
    }

    _artFallback() {
        this._art.set_style('');
        this._artPlaceholder.visible = true;
    }

    _applyArtPixbuf(pixbuf) {
        const size = LAYOUT_SIZES[this._layout];
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor || 1;
        const px = Math.max(1, Math.round(size * scale));
        const width = pixbuf.get_width();
        const height = pixbuf.get_height();
        const side = Math.max(1, Math.min(width, height));
        const square = pixbuf.new_subpixbuf(Math.floor((width - side) / 2), Math.floor((height - side) / 2), side, side);
        const scaled = square.scale_simple(px, px, GdkPixbuf.InterpType.BILINEAR);
        const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'ytmdesktop-miniplayer']);
        try {
            Gio.File.new_for_path(dir).make_directory_with_parents(null);
        } catch (error) {}
        const path = GLib.build_filenamev([dir, `cover-${this._artLoadId}.png`]);
        scaled.savev(path, 'png', [], []);
        if (this._artPath && this._artPath !== path) {
            try {
                Gio.File.new_for_path(this._artPath).delete(null);
            } catch (error) {}
        }
        this._artPath = path;
        this._artPlaceholder.visible = false;
        this._artWrap.set_size(size, size);
        this._artWrap.set_width(size);
        this._artWrap.set_height(size);
        this._art.set_size(size, size);
        this._art.set_width(size);
        this._art.set_height(size);
        this._art.set_clip_to_allocation(true);
        const uri = GLib.filename_to_uri(path, null);
        this._art.set_style(`background-image: url("${uri}"); background-size: cover; background-position: center; background-repeat: no-repeat;`);
    }

    _setArtwork(url) {
        if (url === this._artUrl)
            return;

        this._artUrl = url;
        this._artLoadId = (this._artLoadId || 0) + 1;
        const loadId = this._artLoadId;
        if (!url) {
            this._artFallback();
            return;
        }

        try {
            const file = Gio.File.new_for_uri(url);
            file.read_async(GLib.PRIORITY_DEFAULT, null, (source, readResult) => {
                if (loadId !== this._artLoadId)
                    return;
                try {
                    const stream = source.read_finish(readResult);
                    GdkPixbuf.Pixbuf.new_from_stream_async(stream, null, (_obj, pixbufResult) => {
                        if (loadId !== this._artLoadId)
                            return;
                        try {
                            this._applyArtPixbuf(GdkPixbuf.Pixbuf.new_from_stream_finish(pixbufResult));
                        } catch (error) {
                            console.error(`YTMDesktop artwork decode failed: ${error.message}`);
                            this._artFallback();
                        }
                    });
                } catch (error) {
                    console.error(`YTMDesktop artwork read failed: ${error.message}`);
                    this._artFallback();
                }
            });
        } catch (error) {
            console.error(`YTMDesktop artwork failed: ${error.message}`);
            this._artFallback();
        }
    }

    _duration() {
        return this._state?.track?.durationSeconds ?? 0;
    }

    _updateProgress() {
        const duration = this._duration();
        const progress = Math.min(this._localProgress, duration || this._localProgress);
        this._currentTime.text = formatTime(progress);
        this._totalTime.text = formatTime(duration);

        this._slider.value = duration > 0 ? Math.min(1, progress / duration) : 0;
        const ratio = duration > 0 ? Math.min(1, progress / duration) : 0;
        const trackWidth = Math.max(this._miniProgressTrack.width || 0, 80);
        this._miniProgress.set_width(Math.max(2, Math.round(trackWidth * ratio)));
    }

    _command(command, value = 0) {
        if (command === 'previous' && !this._state?.canPrevious)
            return;
        if (command === 'next' && !this._state?.canNext)
            return;
        if (command === 'seekTo' && !this._state?.track)
            return;
        this._call('Command', command, value);
    }

    _call(method, ...args) {
        if (!this._proxy?.g_name_owner)
            return;

        const remoteMethod = this._proxy[`${method}Remote`];
        remoteMethod.call(this._proxy, ...args, (_result, error) => {
            if (error)
                console.error(`YTMDesktop ${method} failed: ${error.message}`);
        });

        if (!['Command', 'Search', 'PlayResult'].includes(method))
            this.menu.close();
    }

    destroy() {
        this._cancelSearchTimer();
        this._clearLikeOverride();
        if (this._tickId)
            GLib.source_remove(this._tickId);
        if (this._menuOpenId)
            this.menu.disconnect(this._menuOpenId);
        if (this._proxy && this._ownerChangedId)
            this._proxy.disconnect(this._ownerChangedId);
        if (this._proxy && this._stateChangedId)
            this._proxy.disconnectSignal(this._stateChangedId);
        if (this._proxy && this._searchChangedId)
            this._proxy.disconnectSignal(this._searchChangedId);
        this._proxy = null;
        super.destroy();
    }
});

export default class YTMDesktopMiniPlayerExtension extends Extension {
    enable() {
        this._indicator = new MiniPlayerIndicator(this);
        Main.panel.addToStatusArea('ytmdesktop-miniplayer', this._indicator, 1, 'right');
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
