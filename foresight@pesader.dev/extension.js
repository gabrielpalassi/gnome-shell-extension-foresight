import Meta from 'gi://Meta';
import St from 'gi://St';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// Source: https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/windowManager.js?ref_type=heads#L34-35
const DESTROY_WINDOW_ANIMATION_TIME = 150;
const DIALOG_DESTROY_WINDOW_ANIMATION_TIME = 100;

class Foresight {
    constructor(workspaceManager) {
        this._signal = {};
        this._activatedByExtension = false;
        this._workspaceManager = workspaceManager;
        this._currentWorkspace = this._workspaceManager.get_active_workspace();
        this._timeout = null;
        this._mutterSettings = Gio.Settings.new('org.gnome.mutter');

        this._connectSignals();
    }

    // --- Signal Management ---

    _connectSignals() {
        this._connectWorkspaceSignals();

        this._signal['workspace-switched'] = this._workspaceManager.connect(
            'workspace-switched',
            () => this._workspaceSwitched()
        );

        this._signal['overview-hidden'] = Main.overview.connect(
            'hidden',
            () => (this._activatedByExtension = false)
        );
    }

    _disconnectSignals() {
        this._disconnectWorkspaceSignals();

        Main.overview.disconnect(this._signal['overview-hidden']);
        this._workspaceManager.disconnect(this._signal['workspace-switched']);
    }

    _connectWorkspaceSignals() {
        this._signal['window-removed'] = this._currentWorkspace.connect(
            'window-removed',
            (workspace, window) => this._windowRemoved(workspace, window)
        );

        this._signal['window-added'] = this._currentWorkspace.connect(
            'window-added',
            (workspace, window) => this._windowAdded(workspace, window)
        );
    }

    _disconnectWorkspaceSignals() {
        if (this._signal['window-removed'])
            this._currentWorkspace.disconnect(this._signal['window-removed']);

        if (this._signal['window-added'])
            this._currentWorkspace.disconnect(this._signal['window-added']);
    }

    // --- Window Handlers ---

    _windowAdded(workspace, window) {
        if (
            workspace !== this._currentWorkspace ||
            !this._isValidWindow(window, true) ||
            this._isTemporaryWindow(window) ||
            !Main.overview.visible
        )
            return;

        this._hideOverview();
    }

    _windowRemoved(workspace, window) {
        if (
            workspace !== this._currentWorkspace ||
            !this._isValidWindow(window) ||
            this._isTemporaryWindow(window)
        )
            return;

        this._timeout = this._sleep(this._getWindowCloseAnimationTime(window));
        this._timeout.promise.then(() => this._showOverview());
    }

    // --- Workspace Handlers ---

    _workspaceSwitched() {
        this._disconnectWorkspaceSignals();

        this._currentWorkspace = this._workspaceManager.get_active_workspace();
        this._connectWorkspaceSignals();

        if (
            this._currentWorkspace.list_windows().filter(window => this._isValidWindow(window))
                .length > 0 &&
            !Main.overview.dash.showAppsButton.checked
        )
            this._hideOverview();
        else if (!Main.overview.visible) this._showOverview();
    }

    // --- Helper Functions ---

    _showOverview() {
        if (
            this._currentWorkspace.list_windows().filter(window => this._isValidWindow(window))
                .length === 0
        ) {
            Main.overview.show();
            this._activatedByExtension = true;
        }
    }

    _hideOverview() {
        if (this._activatedByExtension) Main.overview.hide();
    }

    _isValidWindow(window, isAdded = false) {
        const validWindowTypes = [
            Meta.WindowType.NORMAL,
            Meta.WindowType.DIALOG,
            Meta.WindowType.MODAL_DIALOG,
        ];

        // For some reason when the window is opened/added via a shortcut window.is_hidden() returns true
        // Use flag isAdded to workaround this ignoring window.is_hidden() in the checks
        if (
            (!isAdded && window.is_hidden()) ||
            validWindowTypes.indexOf(window.get_window_type()) === -1 ||
            (!window.is_on_primary_monitor() &&
                this._mutterSettings.get_boolean('workspaces-only-on-primary'))
        )
            return false;

        return true;
    }

    _isTemporaryWindow(window) {
        // LibreOffice needs a special case because it includes the version in the title
        if (
            /^LibreOffice \d+\.\d+$/.test(window.title) &&
            window.get_wm_class() === 'soffice' &&
            (window.get_sandboxed_app_id() === 'org.libreoffice.LibreOffice' ||
                window.get_sandboxed_app_id() === null)
        )
            return true;

        const temporaryWindows = [
            {
                title: 'Progress Information',
                wmClass: 'DBeaver',
                sandboxedAppId: 'io.dbeaver.DBeaver.Community',
            },
            {
                title: 'DBeaver',
                wmClass: 'java',
                sandboxedAppId: 'io.dbeaver.DBeaver.Community',
            },
            {
                title: 'Steam',
                wmClass: null,
                sandboxedAppId: 'com.valvesoftware.Steam',
            },
            {
                title: 'Sign in to Steam',
                wmClass: 'steam',
                sandboxedAppId: 'com.valvesoftware.Steam',
            },
            {
                title: 'Launching...',
                wmClass: 'steam',
                sandboxedAppId: 'com.valvesoftware.Steam',
            },
            {
                title: 'Discord Updater',
                wmClass: 'discord',
                sandboxedAppId: 'com.discordapp.Discord',
            },
        ];

        for (const temporaryWindow of temporaryWindows) {
            if (
                window.get_title() === temporaryWindow['title'] &&
                window.get_wm_class() === temporaryWindow['wmClass'] &&
                (window.get_sandboxed_app_id() === temporaryWindow['sandboxedAppId'] ||
                    window.get_sandboxed_app_id() === null)
            )
                return true;
        }

        return false;
    }

    _getWindowCloseAnimationTime(window) {
        // If animations are disabled animation time is zero
        if (!St.Settings.get().enable_animations) return 0;

        // Otherwise, the animation time depends on the type of window
        return window.get_window_type() === Meta.WindowType.NORMAL
            ? DESTROY_WINDOW_ANIMATION_TIME
            : DIALOG_DESTROY_WINDOW_ANIMATION_TIME;
    }

    _sleep(ms) {
        let timeoutId;

        return {
            promise: new Promise(resolve => {
                timeoutId = setTimeout(resolve, ms);
            }),
            cancel: () => clearTimeout(timeoutId),
        };
    }

    // --- Extension Lifecycle ---

    destroy() {
        this._disconnectSignals();

        if (this._timeout) this._timeout.cancel();

        this._signal = null;
        this._activatedByExtension = null;
        this._workspaceManager = null;
        this._currentWorkspace = null;
        this._timeout = null;
        this._mutterSettings = null;
    }
}

export default class ForesightExtension extends Extension {
    enable() {
        this._foresight = new Foresight(global.workspace_manager);
    }

    disable() {
        this._foresight.destroy();
        this._foresight = null;
    }
}
