import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {logErrorUnlessCancelled} from 'resource:///org/gnome/shell/misc/errorUtils.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';

const UI_VERSION = 45;
const SERVICE = 'io.github.ytmdesktop.MiniPlayer';
const OBJECT_PATH = '/io/github/ytmdesktop/MiniPlayer';
const SEARCH_DEBOUNCE_MS = 900;
const LAYOUTS = ['small', 'medium', 'large'];
const LAYOUT_SIZES = {small: 48, medium: 96, large: 128};
const SEARCH_ORDERS = ['music', 'video'];
const ART_OVERLAY_ICON_SIZES = {small: 16, medium: 22, large: 28};
const MARQUEE_SPEED_PX_PER_SECOND = 24;

const DBUS_XML = `
<node>
  <interface name="${SERVICE}">
    <method name="GetState">
      <arg type="s" name="stateJson" direction="out"/>
    </method>
    <method name="GetPanelSession"><arg type="s" name="sessionJson" direction="out"/></method>
    <method name="ReportPanelReady"><arg type="u" name="version" direction="in"/><arg type="s" name="session" direction="in"/><arg type="b" name="accepted" direction="out"/></method>
    <method name="Command">
      <arg type="s" name="command" direction="in"/>
      <arg type="d" name="value" direction="in"/>
    </method>
    <method name="ToggleMainWindow"/>
    <method name="ShowMainWindow"/>
    <method name="OpenSettings"/>
    <method name="Quit"/>
    <method name="Search">
      <arg type="s" name="query" direction="in"/>
    </method>
    <method name="SearchByMode">
      <arg type="s" name="query" direction="in"/>
      <arg type="s" name="mode" direction="in"/>
    </method>
    <method name="SearchMusic"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="s" direction="in"/></method>
    <method name="StartResultMix"><arg type="s" direction="in"/></method>
    <signal name="MusicSearchChanged"><arg type="s"/></signal>
    <signal name="MixResultChanged"><arg type="s"/></signal>
    <method name="AlbumBrowse"><arg type="s" name="albumId" direction="in"/><arg type="s" name="continuation" direction="in"/></method>
    <method name="OpenAlbum"><arg type="s" name="albumId" direction="in"/></method>
    <method name="PlayNext"><arg type="s" name="videoId" direction="in"/></method>
    <signal name="AlbumBrowseChanged"><arg type="s" name="pageJson"/></signal>
    <signal name="PlayNextChanged"><arg type="s" name="resultJson"/></signal>
    <method name="PlayResult">
      <arg type="s" name="videoId" direction="in"/>
      <arg type="s" name="action" direction="in"/>
    </method>
    <method name="ArtistBrowse">
      <arg type="s" name="artistId" direction="in"/>
      <arg type="s" name="section" direction="in"/>
      <arg type="s" name="continuation" direction="in"/>
    </method>
    <method name="OpenArtist">
      <arg type="s" name="browseId" direction="in"/>
    </method>
    <signal name="StateChanged">
      <arg type="s" name="stateJson"/>
    </signal>
    <signal name="SearchResultsChanged">
      <arg type="s" name="resultsJson"/>
    </signal>
    <signal name="ArtistBrowseChanged">
      <arg type="s" name="artistBrowseJson"/>
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
        this._musicCategory = 'all';
        this._musicSerial = 0;
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
        this._menuIsOpen = false;
        this._destroyed = false;
        this._marquees = [];
        this._stSettings = St.Settings.get();
        this._animationsChangedId = this._stSettings.connect('notify::enable-animations', () => this._restartMarquees());

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
                this._artistBrowseChangedId = proxy.connectSignal('ArtistBrowseChanged', (_proxy, _sender, [artistBrowseJson]) => this._applyArtistBrowseJson(artistBrowseJson));
                this._musicChangedId = proxy.connectSignal('MusicSearchChanged', (_proxy, _sender, [json]) => this._applyMusicJson(json));
                this._mixChangedId = proxy.connectSignal('MixResultChanged', (_proxy, _sender, [json]) => this._applyQueueJson(json));
                this._albumChangedId = proxy.connectSignal('AlbumBrowseChanged', (_proxy, _sender, [json]) => this._applyAlbumJson(json));
                this._queueChangedId = proxy.connectSignal('PlayNextChanged', (_proxy, _sender, [json]) => this._applyQueueJson(json));
                this._syncOwner();
            },
            null,
            Gio.DBusProxyFlags.DO_NOT_AUTO_START
        );

        this._menuOpenId = this.menu.connect('open-state-changed', (_menu, open) => {
            this._menuIsOpen = open;
            if (open) {
                this._requestState();
                this._restartMarquees();
            } else {
                this._stopMarquees();
            }
        });
        this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            if (this._state?.status === 'playing' && (this._state?.track || this._state?.adPlaying) && !this._dragging) {
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
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                if (this._artistView) {
                    this._closeArtist();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            }
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
        this._musicFirstButton = this._orderButton('Music', 'Music search', 'music');
        this._videoFirstButton = this._orderButton('Videos', 'Video-only search', 'video');
        orderToggle.add_child(this._musicFirstButton);
        orderToggle.add_child(this._videoFirstButton);
        this._resultsHeader.add_child(orderToggle);

        // The artist view's header lives outside the scroll list so Back and Open stay pinned.
        this._artistHeader = new St.BoxLayout({style_class: 'ytmd-artist-header', x_expand: true, visible: false});
        this._artistHeader.add_child(this._artistActionButton('‹ Back', 'Back to results', () => this._closeArtist()));
        this._albumCover = new St.Icon({icon_name: 'audio-x-generic-symbolic', icon_size: 32, visible: false});
        this._artistHeader.add_child(this._albumCover);
        this._artistNameLabel = new St.Label({style_class: 'ytmd-artist-name', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._artistNameLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._artistHeader.add_child(this._artistNameLabel);
        this._artistHeader.add_child(this._artistActionButton('Open in YTMusic', 'Open this artist in YouTube Music', () => {
            if (this._artistView)
                this._call(this._artistView.album ? 'OpenAlbum' : 'OpenArtist', this._artistView.artistId);
        }));
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
        this._musicCategories = new St.BoxLayout({style_class: 'ytmd-order-toggle'});
        this._categoryButtons = new Map();
        for (const category of ['all', 'songs', 'artists', 'albums']) {
            const label = category[0].toUpperCase() + category.slice(1);
            const button = this._artistActionButton(label, `Search ${label}`, () => {
                if (category === this._musicCategory) return;
                this._musicCategory = category;
                this._searchState = null;
                this._runSearch();
            });
            this._categoryButtons.set(category, button);
            this._musicCategories.add_child(button);
        }
        this._resultsBox.add_child(this._musicCategories);
        this._resultsBox.add_child(this._artistHeader);
        this._resultsBox.add_child(this._resultsStatus);
        this._resultsBox.add_child(this._resultsScroll);
        this._queueStatus = new St.Label({text: ' ', style_class: 'ytmd-results-status', x_expand: true});
        this._queueStatus.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._queueStatus.opacity = 0;
        this._resultsBox.add_child(this._queueStatus);
        this._resultsBox.visible = false;
        searchWrap.add_child(this._resultsBox);

        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this.menu.addMenuItem(item);
        const root = new St.BoxLayout({vertical: true, style_class: 'ytmd-popup'});
        item.add_child(root);

        const playerRow = new St.BoxLayout({vertical: false, style_class: 'ytmd-player-row'});
        root.add_child(playerRow);

        this._artWrap = new St.Button({
            style_class: 'ytmd-art-wrap',
            x_expand: false,
            y_expand: false,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START,
            accessible_name: 'Show YouTube Music',
            can_focus: true,
            reactive: true,
            track_hover: true,
        });
        this._artStack = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
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
        this._artOverlay = new St.Widget({
            style_class: 'ytmd-art-overlay',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
            reactive: false,
            opacity: 0,
        });
        this._artOverlayIcon = new St.Icon({
            gicon: this._fileIcon('open-in-window.svg'),
            icon_size: ART_OVERLAY_ICON_SIZES.medium,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._artOverlay.add_child(this._artOverlayIcon);
        this._artStack.add_child(this._art);
        this._artStack.add_child(this._artOverlay);
        this._artWrap.set_child(this._artStack);
        this._artWrap.set_clip_to_allocation(true);
        this._artStack.set_clip_to_allocation(true);
        this._artWrap.connect('notify::hover', () => this._updateArtOverlay());
        this._artWrap.connect('key-focus-in', () => this._updateArtOverlay());
        this._artWrap.connect('key-focus-out', () => this._updateArtOverlay());
        this._artWrap.connect('clicked', () => this._call('ShowMainWindow'));
        playerRow.add_child(this._artWrap);

        const details = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'ytmd-details'});
        playerRow.add_child(details);

        this._titleMarquee = this._createMarquee('Nothing playing', 'ytmd-title');
        this._artistMarquee = this._createMarquee('Open YouTube Music to start playing', 'ytmd-artist');
        const titleRow = new St.BoxLayout({style_class: 'ytmd-title-row', x_expand: true});
        this._adBadge = new St.Label({text: 'AD', style_class: 'ytmd-ad-badge', y_align: Clutter.ActorAlign.CENTER});
        this._adBadge.visible = false;
        titleRow.add_child(this._adBadge);
        titleRow.add_child(this._titleMarquee.clip);
        details.add_child(titleRow);
        details.add_child(this._artistMarquee.clip);

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
        this._mixButton = this._iconButton('mix.svg', 'Start mix', () => this._command('startMix'));
        this._repeatButton = this._iconButton('repeat.svg', 'Repeat', () => this._cycleRepeat());
        this._shuffleButton = this._iconButton('shuffle.svg', 'Shuffle', () => this._command('shuffle'));
        this._skipAdButton = this._iconButton('skip-ad.svg', 'Skip ad', () => this._command('skipAd'), 'ytmd-skip-ad-button');
        this._skipAdButton.visible = false;
        controls.add_child(this._previousButton);
        controls.add_child(this._playButton);
        controls.add_child(this._nextButton);
        controls.add_child(this._likeButton);
        controls.add_child(this._dislikeButton);
        controls.add_child(this._mixButton);
        controls.add_child(this._repeatButton);
        controls.add_child(this._shuffleButton);
        controls.add_child(this._skipAdButton);
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
        this._artStack.set_size(artSize, artSize);
        this._artStack.set_width(artSize);
        this._artStack.set_height(artSize);
        this._art.set_size(artSize, artSize);
        this._art.set_width(artSize);
        this._art.set_height(artSize);
        this._art.set_clip_to_allocation(true);
        this._artOverlayIcon.icon_size = ART_OVERLAY_ICON_SIZES[size];
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
        this._restartMarquees();
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

    _createMarquee(text, styleClass) {
        const clip = new St.Widget({
            style_class: 'ytmd-marquee-clip',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
        });
        clip.set_clip_to_allocation(true);
        const label = new St.Label({
            text,
            style_class: styleClass,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        });
        label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        label.clutter_text.single_line_mode = true;
        clip.add_child(label);

        const marquee = {
            clip,
            label,
            generation: 0,
            pendingId: 0,
            lastClipWidth: -1,
            allocationId: 0,
            mappedId: 0,
        };
        marquee.allocationId = clip.connect('notify::allocation', () => {
            const width = Math.round(clip.width);
            if (width === marquee.lastClipWidth)
                return;
            marquee.lastClipWidth = width;
            this._restartMarquee(marquee);
        });
        marquee.mappedId = label.connect('notify::mapped', () => this._restartMarquee(marquee));
        this._marquees.push(marquee);
        return marquee;
    }

    _setMarqueeText(marquee, text) {
        if (marquee.label.text === text)
            return;
        marquee.label.text = text;
        this._restartMarquee(marquee);
    }

    _canRunMarquee(marquee) {
        return !this._destroyed &&
            this._menuIsOpen &&
            this._stSettings.enable_animations &&
            marquee.label.mapped &&
            marquee.clip.width > 0;
    }

    _cancelMarquee(marquee) {
        marquee.generation += 1;
        if (marquee.pendingId) {
            GLib.source_remove(marquee.pendingId);
            marquee.pendingId = 0;
        }
        marquee.label.remove_transition('translation-x');
        marquee.label.translation_x = 0;
    }

    _restartMarquee(marquee) {
        this._cancelMarquee(marquee);
        if (!this._canRunMarquee(marquee))
            return;
        marquee.pendingId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            marquee.pendingId = 0;
            void this._runMarquee(marquee);
            return GLib.SOURCE_REMOVE;
        });
    }

    _restartMarquees() {
        for (const marquee of this._marquees)
            this._restartMarquee(marquee);
    }

    _stopMarquees() {
        for (const marquee of this._marquees)
            this._cancelMarquee(marquee);
    }

    async _runMarquee(marquee) {
        if (!this._canRunMarquee(marquee))
            return;
        const [, naturalWidth] = marquee.label.get_preferred_width(-1);
        const overflow = Math.max(0, Math.ceil(naturalWidth - marquee.clip.width));
        if (overflow <= 1)
            return;

        const generation = marquee.generation;
        const duration = Math.max(1, Math.round(overflow / MARQUEE_SPEED_PX_PER_SECOND * 1000));
        let firstPass = true;
        try {
            while (generation === marquee.generation && this._canRunMarquee(marquee)) {
                await marquee.label.easeAsync({
                    translation_x: -overflow,
                    delay: firstPass ? 1500 : 1800,
                    duration,
                    mode: Clutter.AnimationMode.LINEAR,
                });
                if (generation !== marquee.generation || !this._canRunMarquee(marquee))
                    return;
                await marquee.label.easeAsync({
                    translation_x: 0,
                    delay: 1200,
                    duration,
                    mode: Clutter.AnimationMode.LINEAR,
                });
                firstPass = false;
            }
        } catch (error) {
            if (generation === marquee.generation && this._canRunMarquee(marquee))
                logErrorUnlessCancelled(error);
        }
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
        this._artistView = null;
        this._searchState = null;
        this._cancelSearchTimer();
        this._runSearch();
    }

    _orderedSearchResults(results) {
        if (this._searchOrder === 'video')
            return results.filter(result => result.kind === 'video');
        const kinds = {songs: 'music', artists: 'artist', albums: 'album'};
        return (this._searchState?.sectionOrder || ['songs', 'artists', 'albums'])
            .flatMap(section => results.filter(result => result.kind === kinds[section]));
    }

    _requestMusic(continuation = '') {
        const state = this._searchState;
        state.requestKey = String(++this._musicSerial);
        state.moreLoading = Boolean(continuation);
        this._call('SearchMusic', state.query, this._musicCategory, state.requestKey, continuation);
    }

    _applyMusicJson(json) {
        let next;
        try { next = JSON.parse(json); } catch (error) { console.error(`YTMDesktop music response failed: ${error.message}`); return; }
        const state = this._searchState;
        const query = this._searchEntry.get_text().trim().replace(/\s+/g, ' ').slice(0, 200);
        if (this._searchOrder !== 'music' || !state || next.requestKey !== state.requestKey ||
            next.query !== query || next.category !== this._musicCategory || next.status === 'loading') return;
        if (next.append) {
            state.moreLoading = false;
            state.moreError = next.status === 'error' ? next.message : null;
            if (next.status === 'ready') {
                const seen = new Set(state.results.filter(item => item.kind === 'artist').map(item => item.artistId));
                for (const item of next.results || []) {
                    if (item.kind === 'artist' && item.artistId && !seen.has(item.artistId)) {
                        seen.add(item.artistId);
                        state.results.push(item);
                    }
                }
                state.artistsNext = next.artistsNext;
                state.artistsVisible += 10;
            }
            this._renderKeepingScroll();
        } else {
            this._searchState = {...next, mode: 'music', artistsVisible: 5};
            this._renderSearch();
        }
    }

    _renderKeepingScroll() {
        const adjustment = this._resultsScroll.vadjustment;
        const value = adjustment.value;
        this._renderSearch();
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (!this._destroyed) adjustment.value = value;
            return GLib.SOURCE_REMOVE;
        });
    }

    _moreArtists() {
        const state = this._searchState;
        if (!state || state.moreLoading) return;
        if (state.artistsVisible < state.results.filter(item => item.kind === 'artist').length) {
            state.artistsVisible += 10;
            this._renderKeepingScroll();
        } else if (state.artistsNext) {
            this._requestMusic(state.artistsNext);
            this._renderKeepingScroll();
        }
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
        this._artistView = null;
        this._renderSearch();
        this._call('SearchByMode', '', this._searchOrder);
    }

    _cancelSearchTimer() {
        if (this._searchTimer) {
            GLib.source_remove(this._searchTimer);
            this._searchTimer = 0;
        }
    }

    _runSearch() {
        const query = this._searchEntry.get_text().trim().replace(/\s+/g, ' ').slice(0, 200);
        if (!query) {
            this._clearSearch();
            return;
        }
        if (query === this._lastSearchQuery && this._searchState?.status === 'loading')
            return;

        if (query !== this._lastSearchQuery)
            this._artistView = null;
        this._lastSearchQuery = query;
        this._searchState = {query, mode: this._searchOrder, status: 'loading', results: []};
        this._renderSearch();
        if (this._searchOrder === 'music') this._requestMusic();
        else this._call('SearchByMode', query, this._searchOrder);
    }

    // The artist view is state, not actors: _renderSearch destroys every row on each render (order
    // toggle, layout change, new page), so it is rebuilt from here every time.
    _openArtist(result) {
        if (!result?.artistId)
            return;
        this._artistView = {
            artistId: result.artistId,
            section: this._searchOrder === 'video' ? 'videos' : 'songs',
            title: result.title || 'Artist',
            artworkUrl: result.artworkUrl ?? null,
            songs: [],
            videos: [],
            songsNext: null,
            videosNext: null,
            loading: 'page',
            message: null,
        };
        this._renderSearch();
        this._call('ArtistBrowse', result.artistId, '', '');
    }

    _openAlbum(result) {
        this._artistView = {album: true, artistId: result.albumId, title: result.title, artworkUrl: result.artworkUrl,
            section: 'songs', songs: [], videos: [], songsNext: null, videosNext: null, loading: 'page', message: null};
        this._renderSearch();
        this._call('AlbumBrowse', result.albumId, '');
    }

    _applyAlbumJson(json) {
        let next;
        try { next = JSON.parse(json); } catch (error) { console.error(`YTMDesktop album response failed: ${error.message}`); return; }
        const view = this._artistView;
        if (!view?.album || view.artistId !== next.albumId || next.status === 'loading') return;
        const initial = view.loading === 'page';
        view.loading = null;
        view.message = next.status === 'error' ? next.message : null;
        if (next.status === 'ready') {
            if (initial) view.songs = [];
            view.title = next.name || view.title;
            view.artworkUrl = next.artworkUrl || view.artworkUrl;
            view.songs.push(...(next.items || []));
            view.songsNext = next.continuation || null;
        }
        this._renderSearch();
    }

    _playNext(result, mix = false) {
        if (this._queuePending) return;
        this._queuePending = result.id;
        this._queueMix = mix;
        this._queueStatus.text = mix ? 'Starting mix…' : 'Adding next…';
        this._queueStatus.opacity = 255;
        if (this._queueMessageTimer) GLib.source_remove(this._queueMessageTimer);
        this._queueMessageTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 12000, () => {
            this._queueMessageTimer = 0;
            if (!this._destroyed) this._applyQueueJson(JSON.stringify({videoId: result.id, status: 'error', message: 'Play next timed out'}));
            return GLib.SOURCE_REMOVE;
        });
        this._call(mix ? 'StartResultMix' : 'PlayNext', result.id);
    }

    _applyQueueJson(json) {
        let result;
        try { result = JSON.parse(json); } catch (error) { console.error(`YTMDesktop queue response failed: ${error.message}`); return; }
        if (result.videoId !== this._queuePending || result.status === 'loading') return;
        this._queuePending = null;
        if (this._queueMessageTimer) GLib.source_remove(this._queueMessageTimer);
        this._queueStatus.text = result.status === 'ready' ? (this._queueMix ? `Mix started for “${result.title}”` : `“${result.title}” added to next`) : result.message || 'Could not add next track';
        this._queueStatus.accessible_name = this._queueStatus.text;
        this._queueStatus.opacity = 255;
        this._queueMessageTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, result.status === 'ready' ? 3000 : 6000, () => {
            this._queueMessageTimer = 0;
            this._queueStatus.opacity = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    _closeArtist() {
        if (!this._artistView)
            return;
        this._artistView = null;
        this._renderSearch();
    }

    _loadMoreArtist(section) {
        const view = this._artistView;
        if (!view || view.loading || section !== view.section)
            return;
        const key = `${section}Next`;
        const next = view[key];
        if (!next)
            return;
        // A browse id is only good for the first page; after that the page hands back tokens.
        view[key] = null;
        view.loading = section;
        this._renderSearch();
        if (view.album)
            this._call('AlbumBrowse', view.artistId, next);
        else
            this._call('ArtistBrowse', view.artistId, section, next);
    }

    _applyArtistBrowseJson(artistBrowseJson) {
        let next;
        try {
            next = JSON.parse(artistBrowseJson);
        } catch (error) {
            console.error(`YTMDesktop artist browse parse failed: ${error.message}`);
            return;
        }

        const view = this._artistView;
        if (!view || next?.artistId !== view.artistId)
            return;
        if (next.status === 'loading')
            return;

        view.loading = null;
        view.message = next.status === 'error' ? (next.message || 'Could not load artist') : null;
        if (next.status === 'ready') {
            if (next.section === '') {
                view.title = next.name || view.title;
                view.artworkUrl = next.artworkUrl ?? view.artworkUrl;
                view.songs = next.songs ?? [];
                view.videos = next.videos ?? [];
                view.songsNext = next.songsNext ?? null;
                view.videosNext = next.videosNext ?? null;
            } else {
                const list = view[next.section];
                const seen = new Set(list.map(item => item.id));
                for (const item of next[next.section] ?? []) {
                    if (!seen.has(item.id)) {
                        seen.add(item.id);
                        list.push(item);
                    }
                }
                view[`${next.section}Next`] = next[`${next.section}Next`] ?? null;
            }
        }
        this._renderSearch();
    }

    _applySearchJson(resultsJson) {
        let nextState;
        try {
            nextState = JSON.parse(resultsJson);
        } catch (error) {
            console.error(`YTMDesktop search parse failed: ${error.message}`);
            return;
        }

        if ((nextState.mode ?? 'music') !== this._searchOrder)
            return;
        const currentQuery = this._searchEntry.get_text().trim().replace(/\s+/g, ' ').slice(0, 200);
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

        // Opening an artist replaces the whole list with a one-line "Loading…" until the page
        // arrives, which made the popup shrink and grow again. Keep the height it had until then.
        const previousHeight = this._resultsScroll.visible ? this._resultsScroll.get_height() : 0;
        this._resultsScroll.set_style(null);

        const children = this._resultsList.get_children();
        for (const child of children)
            child.destroy();

        this._musicCategories.visible = this._searchOrder === 'music' && !this._artistView;
        for (const [category, button] of this._categoryButtons)
            button[category === this._musicCategory ? 'add_style_class_name' : 'remove_style_class_name']('ytmd-order-button-selected');
        if (this._artistView) {
            this._renderArtistView(previousHeight);
            return;
        }
        this._artistHeader.visible = false;

        const search = this._searchState;
        if (!search || search.status === 'idle') {
            this._resultsBox.visible = false;
            return;
        }

        this._resultsBox.visible = true;
        this._resultsHeader.visible = true;
        this._musicFirstButton[this._searchOrder === 'music' ? 'add_style_class_name' : 'remove_style_class_name']('ytmd-order-button-selected');
        this._videoFirstButton[this._searchOrder === 'video' ? 'add_style_class_name' : 'remove_style_class_name']('ytmd-order-button-selected');
        if (search.status === 'loading') {
            this._resultsStatus.text = 'Searching…';
            this._resultsStatus.visible = true;
            this._resultsScroll.visible = false;
            return;
        }

        if (search.status === 'error' || !search.results?.length) {
            this._resultsStatus.text = search.message || (this._searchOrder === 'video' ? 'No videos found' : 'No songs found');
            this._resultsStatus.visible = true;
            this._resultsScroll.visible = false;
            return;
        }

        this._resultsStatus.visible = false;
        this._resultsHeader.visible = true;
        this._resultsScroll.visible = true;
        this._musicFirstButton[this._searchOrder === 'music' ? 'add_style_class_name' : 'remove_style_class_name']('ytmd-order-button-selected');
        this._videoFirstButton[this._searchOrder === 'video' ? 'add_style_class_name' : 'remove_style_class_name']('ytmd-order-button-selected');
        let lastKind = null;
        const ordered = this._orderedSearchResults(search.results);
        let artistCount = 0;
        for (let index = 0; index < ordered.length; index++) {
            const result = ordered[index];
            if (result.kind === 'artist' && ++artistCount > search.artistsVisible) continue;
            const kind = ['artist', 'album', 'video'].includes(result.kind) ? result.kind : 'music';
            if (kind !== lastKind) {
                this._resultsList.add_child(this._sectionDivider({artist: 'Artists', album: 'Albums', video: 'Videos', music: 'Songs'}[kind]));
                lastKind = kind;
            }
            this._resultsList.add_child(this._createResultRow(result));
            if (result.kind === 'artist' && (artistCount === search.artistsVisible || ordered[index + 1]?.kind !== 'artist')) {
                if (search.moreError) this._resultsList.add_child(new St.Label({text: search.moreError, style_class: 'ytmd-artist-status'}));
                if (ordered.filter(item => item.kind === 'artist').length > artistCount || search.artistsNext) {
                    const more = this._artistActionButton(search.moreLoading ? 'Loading…' : 'See more', 'See more artists', () => this._moreArtists());
                    more.reactive = !search.moreLoading;
                    this._resultsList.add_child(more);
                }
            }
        }
    }

    // "Songs ─────": a tiny grey label with a rule running to the edge.
    _sectionDivider(text) {
        const row = new St.BoxLayout({style_class: 'ytmd-section-divider', x_expand: true});
        row.add_child(new St.Label({text, style_class: 'ytmd-section-divider-label', y_align: Clutter.ActorAlign.CENTER}));
        row.add_child(new St.Widget({style_class: 'ytmd-section-divider-line', x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        return row;
    }

    // iPod-style drill-down: the results list is replaced wholesale by the artist's page, with
    // Back and Open pinned in the header above the scroll area.
    _renderArtistView(previousHeight = 0) {
        const view = this._artistView;
        this._resultsBox.visible = true;
        this._resultsHeader.visible = false;
        this._resultsStatus.visible = false;
        this._resultsScroll.visible = true;
        this._artistHeader.visible = true;
        this._artistNameLabel.text = view.title;
        this._albumCover.visible = Boolean(view.album);
        if (view.album) {
            this._albumCover.gicon = view.artworkUrl ? new Gio.FileIcon({file: Gio.File.new_for_uri(view.artworkUrl)}) : null;
            if (!view.artworkUrl) this._albumCover.icon_name = 'audio-x-generic-symbolic';
        }

        if (view.loading === 'page') {
            if (previousHeight > 0)
                this._resultsScroll.set_style(`min-height: ${Math.round(previousHeight)}px;`);
            this._resultsList.add_child(new St.Label({text: 'Loading…', style_class: 'ytmd-artist-status'}));
            return;
        }
        if (view.message) {
            this._resultsList.add_child(new St.Label({text: view.message, style_class: 'ytmd-artist-status'}));
            if (!view[view.section].length)
                return;
        }

        if (view.section === 'videos')
            this._addArtistSection('Videos', 'videos', 'More videos', view);
        else
            this._addArtistSection('Songs', 'songs', 'More songs', view);
    }

    _addArtistSection(label, section, moreLabel, view) {
        this._resultsList.add_child(this._sectionDivider(label));
        for (const item of view[section])
            this._resultsList.add_child(this._createResultRow(view.album && !item.artworkUrl ? {...item, artworkUrl: view.artworkUrl} : item));

        if (view.loading === section) {
            this._resultsList.add_child(new St.Label({text: 'Loading…', style_class: 'ytmd-artist-status'}));
        } else if (view[`${section}Next`]) {
            const actions = new St.BoxLayout({style_class: 'ytmd-artist-actions', x_expand: true});
            actions.add_child(this._artistActionButton(moreLabel, `${moreLabel} by ${view.title}`, () => this._loadMoreArtist(section)));
            this._resultsList.add_child(actions);
        } else if (!view[section].length) {
            this._resultsList.add_child(new St.Label({text: `No ${section} found`, style_class: 'ytmd-artist-status'}));
        }
    }

    _artistActionButton(label, accessibleName, callback) {
        const button = new St.Button({
            label,
            style_class: 'ytmd-artist-action',
            accessible_name: accessibleName,
            can_focus: true,
            reactive: true,
            track_hover: true,
        });
        button.connect('clicked', callback);
        return button;
    }

    _createResultRow(result) {
        const row = new St.BoxLayout({style_class: 'ytmd-result-row', x_expand: true});

        // The thumbnail is the play control: hovering or focusing it reveals a play overlay and
        // clicking plays the result. Same pattern as the main artwork, which opens the app.
        const isArtist = result.kind === 'artist' && Boolean(result.artistId);
        // Artist rows without a radio id have nothing to play; their id is only a display key.
        const isAlbum = result.kind === 'album' && Boolean(result.albumId);
        const playable = /^[A-Za-z0-9_-]{11}$/.test(result.id);
        const artWrap = new St.Button({
            style_class: 'ytmd-result-art-wrap',
            accessible_name: playable ? `Play ${result.title || 'result'}` : result.title || 'result',
            can_focus: playable || isAlbum,
            reactive: playable || isAlbum,
            track_hover: playable,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const artStack = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: true});
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
        const artOverlay = new St.Widget({
            style_class: 'ytmd-result-art-overlay',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
            reactive: false,
            opacity: 0,
        });
        artOverlay.add_child(new St.Icon({
            gicon: this._fileIcon('play.svg'),
            icon_size: 18,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        artStack.add_child(art);
        artStack.add_child(artOverlay);
        artWrap.set_child(artStack);
        artWrap.set_clip_to_allocation(true);
        artStack.set_clip_to_allocation(true);
        const updateOverlay = () => {
            const visible = artWrap.hover || artWrap.has_key_focus();
            artOverlay.ease({opacity: visible ? 255 : 0, duration: 150, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        };
        artWrap.connect('notify::hover', updateOverlay);
        artWrap.connect('key-focus-in', updateOverlay);
        artWrap.connect('key-focus-out', updateOverlay);
        if (isAlbum) artWrap.connect('clicked', () => this._openAlbum(result));
        if (playable)
            artWrap.connect('clicked', () => this._call('PlayResult', result.id, 'now'));

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

        row.add_child(artWrap);
        if (isArtist || isAlbum) {
            // The row body opens the artist's page; the thumbnail keeps playing the radio.
            const detailsButton = new St.Button({
                style_class: 'ytmd-result-details-button',
                accessible_name: `Open ${result.title}`,
                can_focus: true,
                reactive: true,
                track_hover: true,
                x_expand: true,
            });
            detailsButton.set_child(details);
            detailsButton.connect('clicked', () => isAlbum ? this._openAlbum(result) : this._openArtist(result));
            row.add_child(detailsButton);
        } else {
            row.add_child(details);
        }
        if (playable && !isArtist && !isAlbum) {
            for (const [icon, action, supported, mix] of [
                ['mix.svg', 'Start mix', result.canStartMix, true],
                ['play-next.svg', 'Play next', result.canPlayNext, false],
            ]) {
                const label = `${action}: ${result.title}${supported ? '' : ' — unavailable: no supported endpoint'}`;
                const button = this._iconButton(icon, label, () => { if (supported) this._playNext(result, mix); });
                button.opacity = supported ? 255 : 90;
                button.reactive = Boolean(supported);
                const hover = new St.BoxLayout({reactive: true, track_hover: true});
                hover.add_child(button);
                const tip = new St.Label({text: label, style_class: 'ytmd-action-tooltip', visible: false});
                Main.layoutManager.addChrome(tip);
                hover.connect('notify::hover', () => {
                    tip.visible = hover.hover;
                    if (hover.hover) {
                        const [x, y] = button.get_transformed_position();
                        tip.set_position(Math.max(0, x - tip.width + button.width), y + button.height);
                    }
                });
                button.connect('destroy', () => tip.destroy());
                row.add_child(hover);
            }
        }
        return row;
    }

    _syncOwner() {
        const running = Boolean(this._proxy?.g_name_owner);
        this.visible = false;
        this._readyOwner = null;
        this._reportingOwner = null;
        if (this._readyTimer) { GLib.source_remove(this._readyTimer); this._readyTimer = 0; }
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
            this._reportReady();
        });
    }

    _reportReady() {
        const owner = this._proxy?.g_name_owner;
        if (!owner || this._readyOwner === owner || this._reportingOwner === owner || !this._state) return;
        this._reportingOwner = owner;
        const deadline = GLib.get_monotonic_time() + 10000000;
        const report = () => {
            if (this._destroyed || this._proxy?.g_name_owner !== owner) return GLib.SOURCE_REMOVE;
            if (!this.get_parent()) {
                if (GLib.get_monotonic_time() < deadline) return GLib.SOURCE_CONTINUE;
                console.error(`YTMDesktop UI v${UI_VERSION} was not attached to the panel`);
                this._readyTimer = 0;
                return GLib.SOURCE_REMOVE;
            }
            this._readyTimer = 0;
            this._proxy.GetPanelSessionRemote((result, error) => {
                if (this._destroyed || this._proxy?.g_name_owner !== owner) return;
                if (error) { console.error(`YTMDesktop UI readiness failed: ${error.message}`); return; }
                let session;
                try { session = JSON.parse(result[0]); } catch (error) { console.error(`YTMDesktop invalid panel session: ${error.message}`); return; }
                if (session.version !== UI_VERSION) { console.error(`YTMDesktop UI version mismatch: loaded ${UI_VERSION}, app ${session.version}`); return; }
                this._proxy.ReportPanelReadyRemote(UI_VERSION, session.session, (reply, reportError) => {
                    if (this._destroyed || this._proxy?.g_name_owner !== owner) return;
                    if (reportError || reply?.[0] !== true) { console.error(`YTMDesktop UI readiness rejected: ${reportError?.message || 'expired session'}`); return; }
                    this._readyOwner = owner;
                    this.visible = true;
                    console.log(`YTMDesktop UI v${UI_VERSION} ready`);
                });
            });
            return GLib.SOURCE_REMOVE;
        };
        this._readyTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, report);
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
        const adChanged = Boolean(this._state?.adPlaying) !== Boolean(nextState?.adPlaying);
        const trackChanged = adChanged || this._state?.track?.id !== nextState?.track?.id;
        const wasPlaying = this._state?.status === 'playing';
        const duration = this._duration();
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
        const ad = this._adState();
        const playing = this._state?.status === 'playing';
        const needsMainApp = this._state?.status === 'needs-main-app';

        // An ad does not change track, so the panel would otherwise keep showing the interrupted
        // song while something else is audible.
        this._adBadge.visible = Boolean(ad);
        this._setMarqueeText(this._titleMarquee, ad ? `(AD) ${ad.title || 'Advertisement'}` : track?.title || 'Nothing playing');
        this._setMarqueeText(
            this._artistMarquee,
            ad
                ? ad.skipHint || ad.advertiser || 'Advertisement'
                : track?.artist || this._state?.message || 'Open YouTube Music to start playing'
        );
        // Video ads carry no artwork, and reusing the song's art is exactly what made the card lie.
        this._setArtwork(ad ? (ad.artworkUrl ?? null) : (track?.artworkUrl ?? null));

        this._setButtonIcon(this._playButton, playing ? 'pause-dark.svg' : 'play-dark.svg');
        this._playButton.accessible_name = playing ? 'Pause' : 'Play';
        this._setButtonEnabled(this._previousButton, Boolean(this._state?.canPrevious));
        this._setButtonEnabled(this._playButton, Boolean(this._state?.canPlay));
        this._setButtonEnabled(this._nextButton, Boolean(this._state?.canNext));

        this._skipAdButton.visible = Boolean(ad);
        this._setButtonEnabled(this._skipAdButton, Boolean(this._state?.canSkipAd));
        this._skipAdButton.accessible_name = this._state?.canSkipAd ? 'Skip ad' : ad?.skipHint || 'Ad cannot be skipped yet';

        this._slider.reactive = !ad && Boolean(track) && this._duration() > 0;
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

    _updateArtOverlay() {
        const visible = this._artWrap.hover || this._artWrap.has_key_focus();
        this._artOverlay.ease({
            opacity: visible ? 255 : 0,
            duration: 150,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
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
        if (!this._state?.canLike)
            return;
        this._setLikeOverride(this._currentLikeStatus() === 'like' ? 'indifferent' : 'like');
        this._command('toggleLike');
    }

    _toggleDislike() {
        if (!this._state?.canLike)
            return;
        this._setLikeOverride(this._currentLikeStatus() === 'dislike' ? 'indifferent' : 'dislike');
        this._command('toggleDislike');
    }

    _updateLikeButtons() {
        // Rating needs an account; playback does not, so this is the only auth-gated control.
        const canLike = Boolean(this._state?.canLike);
        this._setButtonEnabled(this._likeButton, canLike);
        this._setButtonEnabled(this._dislikeButton, canLike);
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
        this._artStack.set_size(size, size);
        this._artStack.set_width(size);
        this._artStack.set_height(size);
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

    _adState() {
        return this._state?.adPlaying ? this._state.ad ?? {} : null;
    }

    _duration() {
        const ad = this._adState();
        if (ad)
            return ad.durationSeconds ?? 0;
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
        if (command === 'seekTo' && (!this._state?.track || this._state?.adPlaying))
            return;
        if ((command === 'toggleLike' || command === 'toggleDislike') && !this._state?.canLike)
            return;
        if (command === 'skipAd' && !this._state?.canSkipAd)
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

        if (!['Command', 'Search', 'SearchByMode', 'PlayResult', 'ArtistBrowse', 'AlbumBrowse', 'PlayNext', 'SearchMusic', 'StartResultMix'].includes(method))
            this.menu.close();
    }

    destroy() {
        this._destroyed = true;
        if (this._readyTimer) GLib.source_remove(this._readyTimer);
        if (this._queueMessageTimer) GLib.source_remove(this._queueMessageTimer);
        this._stopMarquees();
        for (const marquee of this._marquees) {
            if (marquee.allocationId)
                marquee.clip.disconnect(marquee.allocationId);
            if (marquee.mappedId)
                marquee.label.disconnect(marquee.mappedId);
        }
        this._marquees = [];
        if (this._stSettings && this._animationsChangedId)
            this._stSettings.disconnect(this._animationsChangedId);
        this._animationsChangedId = 0;
        this._stSettings = null;
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
        if (this._proxy && this._artistBrowseChangedId)
            this._proxy.disconnectSignal(this._artistBrowseChangedId);
        if (this._proxy && this._albumChangedId) this._proxy.disconnectSignal(this._albumChangedId);
        if (this._proxy && this._queueChangedId) this._proxy.disconnectSignal(this._queueChangedId);
        if (this._proxy && this._musicChangedId) this._proxy.disconnectSignal(this._musicChangedId);
        if (this._proxy && this._mixChangedId) this._proxy.disconnectSignal(this._mixChangedId);
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
