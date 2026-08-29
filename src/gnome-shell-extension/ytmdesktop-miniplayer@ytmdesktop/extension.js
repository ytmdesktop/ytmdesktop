import Clutter from 'gi://Clutter';
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
    <signal name="StateChanged">
      <arg type="s" name="stateJson"/>
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

const MiniPlayerIndicator = GObject.registerClass(
class MiniPlayerIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'YTMDesktop Mini Player');

        this._state = null;
        this._localProgress = 0;
        this._dragging = false;
        this._seekTarget = null;
        this._seekDeadline = 0;
        this._artUrl = null;

        this.add_child(new St.Icon({
            icon_name: 'youtube-music-desktop-app',
            style_class: 'system-status-icon',
        }));

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
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this.menu.addMenuItem(item);

        const root = new St.BoxLayout({vertical: true, style_class: 'ytmd-popup'});
        item.add_child(root);

        const playerRow = new St.BoxLayout({vertical: false, style_class: 'ytmd-player-row'});
        root.add_child(playerRow);

        this._art = new St.Icon({
            icon_name: 'audio-x-generic-symbolic',
            icon_size: 112,
            style_class: 'ytmd-art',
        });
        playerRow.add_child(this._art);

        const details = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'ytmd-details'});
        playerRow.add_child(details);

        this._title = new St.Label({text: 'Nothing playing', style_class: 'ytmd-title', x_expand: true});
        this._title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._artist = new St.Label({text: 'Open YouTube Music to start playing', style_class: 'ytmd-artist', x_expand: true});
        this._artist.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        details.add_child(this._title);
        details.add_child(this._artist);

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
        details.add_child(this._slider);

        const times = new St.BoxLayout({style_class: 'ytmd-times'});
        this._currentTime = new St.Label({text: '0:00'});
        this._totalTime = new St.Label({text: '0:00', x_expand: true, x_align: Clutter.ActorAlign.END});
        times.add_child(this._currentTime);
        times.add_child(this._totalTime);
        details.add_child(times);

        const controls = new St.BoxLayout({style_class: 'ytmd-controls', x_align: Clutter.ActorAlign.CENTER});
        this._previousButton = this._iconButton('media-skip-backward-symbolic', 'Previous', () => this._command('previous'));
        this._playButton = this._iconButton('media-playback-start-symbolic', 'Play', () => this._command('playPause'), 'ytmd-play-button');
        this._nextButton = this._iconButton('media-skip-forward-symbolic', 'Next', () => this._command('next'));
        controls.add_child(this._previousButton);
        controls.add_child(this._playButton);
        controls.add_child(this._nextButton);
        details.add_child(controls);

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
        footer.add_child(this._iconButton('focus-windows-symbolic', 'Show or hide window', () => this._call('ToggleMainWindow')));
        footer.add_child(this._iconButton('emblem-system-symbolic', 'Settings', () => this._call('OpenSettings')));
        footer.add_child(this._iconButton('system-shutdown-symbolic', 'Quit', () => this._call('Quit'), 'ytmd-quit-button'));
        root.add_child(footer);
    }

    _iconButton(iconName, accessibleName, callback, styleClass = '') {
        const button = new St.Button({
            style_class: `ytmd-icon-button ${styleClass}`,
            accessible_name: accessibleName,
            can_focus: true,
            reactive: true,
            track_hover: true,
        });
        button.set_child(new St.Icon({icon_name: iconName, icon_size: 22}));
        button.connect('clicked', callback);
        return button;
    }

    _syncOwner() {
        const running = Boolean(this._proxy?.g_name_owner);
        this.visible = running;
        if (running)
            this._requestState();
        else
            this.menu.close();
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
        this._state = nextState;
        if (!this._dragging) {
            if (!trackChanged && this._seekTarget !== null && Math.abs(incomingProgress - this._seekTarget) > 1.5 && Date.now() < this._seekDeadline) {
                this._updateUi();
                return;
            }
            this._seekTarget = null;
            this._localProgress = incomingProgress;
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

        const playIcon = this._playButton.get_child();
        playIcon.icon_name = playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        this._playButton.accessible_name = playing ? 'Pause' : 'Play';
        this._setButtonEnabled(this._previousButton, Boolean(this._state?.canPrevious));
        this._setButtonEnabled(this._playButton, Boolean(this._state?.canPlay));
        this._setButtonEnabled(this._nextButton, Boolean(this._state?.canNext));

        this._slider.reactive = Boolean(track) && this._duration() > 0;
        this._openAppButton.visible = needsMainApp;
        this._updateProgress();
    }

    _setButtonEnabled(button, enabled) {
        button.reactive = enabled;
        button.can_focus = enabled;
        button.opacity = enabled ? 255 : 90;
    }

    _setArtwork(url) {
        if (url === this._artUrl)
            return;

        this._artUrl = url;
        if (!url) {
            this._art.gicon = null;
            this._art.icon_name = 'audio-x-generic-symbolic';
            return;
        }

        try {
            this._art.icon_name = null;
            this._art.gicon = new Gio.FileIcon({file: Gio.File.new_for_uri(url)});
        } catch (error) {
            console.error(`YTMDesktop artwork failed: ${error.message}`);
            this._art.gicon = null;
            this._art.icon_name = 'audio-x-generic-symbolic';
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
    }

    _command(command, value = 0) {
        if (command === 'playPause' && !this._state?.canPlay)
            return;
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

        if (method !== 'Command')
            this.menu.close();
    }

    destroy() {
        if (this._tickId)
            GLib.source_remove(this._tickId);
        if (this._menuOpenId)
            this.menu.disconnect(this._menuOpenId);
        if (this._proxy && this._ownerChangedId)
            this._proxy.disconnect(this._ownerChangedId);
        if (this._proxy && this._stateChangedId)
            this._proxy.disconnectSignal(this._stateChangedId);
        this._proxy = null;
        super.destroy();
    }
});

export default class YTMDesktopMiniPlayerExtension extends Extension {
    enable() {
        this._indicator = new MiniPlayerIndicator();
        Main.panel.addToStatusArea('ytmdesktop-miniplayer', this._indicator, 1, 'right');
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
