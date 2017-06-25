import { AbstractView } from './view';
import { App } from '../app';
import { IpcEvent } from '../note-manager';
import { ipcRenderer } from 'electron';

const CLASS_SPIN = 'fa-spin';

const quickAccessers = {
    readNote: {
        handler: 'readNote',
        icon: 'fa fa-eye',
        title: 'Read note'
    },
    editNote: {
        handler: 'editNote',
        icon: 'fa fa-pencil',
        title: 'Edit note'
    },
    livePreview: {
        handler: 'livePreview',
        icon: 'fa fa-pencil-square-o',
        title: 'Live preview'
    },
    openOrphanNote: {
        handler: 'openOrphanNote',
        icon: 'fa fa-sticky-note-o',
        title: 'Open a new note'
    },
    saveNote: {
        handler: 'saveNote',
        icon: 'fa fa-floppy-o',
        title: 'Save note'
    },
    syncNotes: {
        handler: (event) => {
            let el = $(event.currentTarget).find('i');

            if (el.hasClass(CLASS_SPIN)) {
                return;
            }

            App.getInstance().execCommand('syncNotes');
            el.addClass(CLASS_SPIN);
        },
        icon: 'fa fa-refresh',
        title: 'Sync notes',
    },
};

const SETTING_HTML = `<div class="setting">
    <a href="javascript:void(0)"><i class="fa fa-gear"></i></a>
</div>`;

function accesserHtml(command: string, icon: string, title: string) {
    return `
<li class="nav-item" title="${title}" _data="${command}">
    <a href="javascript:void(0)"><i class="${icon}"></i></a>
</li>`;
}

export class HeaderView extends AbstractView {
    constructor() {
        super('#header');
    }

    init() {
        let container = this._el.find('> nav > ul');
        for (let name in quickAccessers) {
            let accesser = quickAccessers[name];
            $(accesserHtml(name, accesser.icon, accesser.title)).appendTo(container);
        }

        this._el.append(SETTING_HTML);

        let app = App.getInstance();
        this._el.on('click', '> nav > ul .nav-item', (event) => {
            let name = event.currentTarget.getAttribute('_data');
            let handler = quickAccessers[name].handler;
            if (typeof handler === 'string') {
                app.execCommand(name);
            } else {
                handler(event);
            }
        });

        this._el.on('click', '.setting', () => {
            app.execCommand('openSettingPanel');
        });

        // TODO: Should Refactor
        ipcRenderer.on(IpcEvent.syncComplete, () => {
            this._el.find('[_data=syncNotes]').find('i').removeClass(CLASS_SPIN);
        });
        ipcRenderer.on(IpcEvent.syncFailed, () => {
            this._el.find('[_data=syncNotes]').find('i').removeClass(CLASS_SPIN);
        });
    }
}