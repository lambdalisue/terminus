import '@vaadin/vaadin-context-menu/vaadin-context-menu.js'
import copyToClipboard from 'copy-text-to-clipboard'
import { Injectable } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { PlatformService, ClipboardContent, MenuItemOptions, MessageBoxOptions, MessageBoxResult } from 'terminus-core'

// eslint-disable-next-line no-duplicate-imports
import type { ContextMenuElement, ContextMenuItem } from '@vaadin/vaadin-context-menu/vaadin-context-menu.js'

import { MessageBoxModalComponent } from './components/messageBoxModal.component'
import './styles.scss'

@Injectable()
export class WebPlatformService extends PlatformService {
    private menu: ContextMenuElement
    private contextMenuHandlers = new Map<ContextMenuItem, () => void>()

    constructor (
        private ngbModal: NgbModal,
    ) {
        super()
        this.menu = window.document.createElement('vaadin-context-menu')
        this.menu.addEventListener('item-selected', e => {
            this.contextMenuHandlers.get(e.detail.value)?.()
        })
        document.body.appendChild(this.menu)
    }

    readClipboard (): string {
        return ''
    }

    setClipboard (content: ClipboardContent): void {
        copyToClipboard(content.text)
    }

    async loadConfig (): Promise<string> {
        return window['terminusConfig']
    }

    async saveConfig (content: string): Promise<void> {
        console.log('config save', content)
    }

    getOSRelease (): string {
        return '1.0'
    }

    openExternal (url: string): void {
        window.open(url)
    }

    getAppVersion (): string {
        return '1.0-web'
    }

    async listFonts (): Promise<string[]> {
        return []
    }

    popupContextMenu (menu: MenuItemOptions[], event?: MouseEvent): void {
        this.contextMenuHandlers.clear()
        this.menu.items = menu
            .filter(x => x.type !== 'separator')
            .map(x => this.remapMenuItem(x))
        setTimeout(() => {
            this.menu.open(event)
        }, 10)
    }

    private remapMenuItem (item: MenuItemOptions): ContextMenuItem {
        const cmi = {
            text: item.label,
            disabled: !(item.enabled ?? true),
            checked: item.checked,
            children: item.submenu?.map(i => this.remapMenuItem(i)),
        }
        if (item.click) {
            this.contextMenuHandlers.set(cmi, item.click)
        }
        return cmi
    }

    async showMessageBox (options: MessageBoxOptions): Promise<MessageBoxResult> {
        console.log(options)
        const modal = this.ngbModal.open(MessageBoxModalComponent, {
            backdrop: 'static',
        })
        const instance: MessageBoxModalComponent = modal.componentInstance
        instance.options = options
        try {
            const response = await modal.result
            return { response }
        } catch {
            return { response: 0 }
        }
    }
}
