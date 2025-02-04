import { Observable, Subject, AsyncSubject } from 'rxjs'
import * as yaml from 'js-yaml'
import { Injectable, Inject } from '@angular/core'
import { ConfigProvider } from '../api/configProvider'
import { PlatformService } from '../api/platform'
import { HostAppService } from './hostApp.service'
const deepmerge = require('deepmerge')

const configMerge = (a, b) => deepmerge(a, b, { arrayMerge: (_d, s) => s }) // eslint-disable-line @typescript-eslint/no-var-requires

function isStructuralMember (v) {
    return v instanceof Object && !(v instanceof Array) &&
        Object.keys(v).length > 0 && !v.__nonStructural
}

function isNonStructuralObjectMember (v): boolean {
    return v instanceof Object && !(v instanceof Array) && v.__nonStructural
}

/** @hidden */
export class ConfigProxy {
    constructor (real: Record<string, any>, defaults: Record<string, any>) {
        for (const key in defaults) {
            if (isStructuralMember(defaults[key])) {
                if (!real[key]) {
                    real[key] = {}
                }
                const proxy = new ConfigProxy(real[key], defaults[key])
                Object.defineProperty(
                    this,
                    key,
                    {
                        enumerable: true,
                        configurable: false,
                        get: () => proxy,
                    }
                )
            } else {
                Object.defineProperty(
                    this,
                    key,
                    {
                        enumerable: true,
                        configurable: false,
                        get: () => this.getValue(key),
                        set: (value) => {
                            this.setValue(key, value)
                        },
                    }
                )
            }
        }

        this.getValue = (key: string) => { // eslint-disable-line @typescript-eslint/unbound-method
            if (real[key] !== undefined) {
                return real[key]
            } else {
                if (isNonStructuralObjectMember(defaults[key])) {
                    real[key] = { ...defaults[key] }
                    delete real[key].__nonStructural
                    return real[key]
                } else {
                    return defaults[key]
                }
            }
        }

        this.setValue = (key: string, value: any) => { // eslint-disable-line @typescript-eslint/unbound-method
            real[key] = value
        }
    }

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/no-empty-function
    getValue (_key: string): any { }
    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/no-empty-function
    setValue (_key: string, _value: any) { }
}

@Injectable({ providedIn: 'root' })
export class ConfigService {
    /**
     * Contains the actual config values
     */
    store: any

    /**
     * Whether an app restart is required due to recent changes
     */
    restartRequested: boolean

    /** Fires once when the config is loaded */
    get ready$ (): Observable<boolean> { return this.ready }

    private ready = new AsyncSubject<boolean>()
    private changed = new Subject<void>()
    private _store: any
    private defaults: any
    private servicesCache: Record<string, Function[]>|null = null // eslint-disable-line @typescript-eslint/ban-types

    get changed$ (): Observable<void> { return this.changed }

    /** @hidden */
    private constructor (
        private hostApp: HostAppService,
        private platform: PlatformService,
        @Inject(ConfigProvider) private configProviders: ConfigProvider[],
    ) {
        this.defaults = this.mergeDefaults()
        this.init()
    }

    mergeDefaults (): unknown {
        const providers = this.configProviders
        return providers.map(provider => {
            let defaults = provider.platformDefaults[this.hostApp.configPlatform] ?? {}
            defaults = configMerge(
                defaults,
                provider.platformDefaults[this.hostApp.platform] ?? {},
            )
            if (provider.defaults) {
                defaults = configMerge(provider.defaults, defaults)
            }
            return defaults
        }).reduce(configMerge)
    }

    getDefaults (): Record<string, any> {
        const cleanup = o => {
            if (o instanceof Array) {
                return o.map(cleanup)
            } else if (o instanceof Object) {
                const r = {}
                for (const k of Object.keys(o)) {
                    if (k !== '__nonStructural') {
                        r[k] = cleanup(o[k])
                    }
                }
                return r
            } else {
                return o
            }
        }
        return cleanup(this.defaults)
    }

    async load (): Promise<void> {
        const content = await this.platform.loadConfig()
        if (content) {
            this._store = yaml.load(content)
        } else {
            this._store = {}
        }
        this.store = new ConfigProxy(this._store, this.defaults)
    }

    async save (): Promise<void> {
        // Scrub undefined values
        const cleanStore = JSON.parse(JSON.stringify(this._store))
        await this.platform.saveConfig(yaml.dump(cleanStore))
        this.emitChange()
        this.hostApp.broadcastConfigChange(JSON.parse(JSON.stringify(this.store)))
    }

    /**
     * Reads config YAML as string
     */
    readRaw (): string {
        return yaml.dump(this._store)
    }

    /**
     * Writes config YAML as string
     */
    writeRaw (data: string): void {
        this._store = yaml.load(data)
        this.save()
        this.load()
        this.emitChange()
    }

    requestRestart (): void {
        this.restartRequested = true
    }

    /**
     * Filters a list of Angular services to only include those provided
     * by plugins that are enabled
     *
     * @typeparam T Base provider type
     */
    enabledServices<T extends object> (services: T[]): T[] { // eslint-disable-line @typescript-eslint/ban-types
        if (!this.servicesCache) {
            this.servicesCache = {}
            const ngModule = window['rootModule'].ɵinj
            for (const imp of ngModule.imports) {
                const module = imp.ngModule || imp
                if (module.ɵinj?.providers) {
                    this.servicesCache[module.pluginName] = module.ɵinj.providers.map(provider => {
                        return provider.useClass || provider
                    })
                }
            }
        }
        return services.filter(service => {
            for (const pluginName in this.servicesCache) {
                if (this.servicesCache[pluginName].includes(service.constructor)) {
                    return !this.store.pluginBlacklist.includes(pluginName)
                }
            }
            return true
        })
    }

    private async init () {
        await this.load()
        this.ready.next(true)
        this.ready.complete()

        this.hostApp.configChangeBroadcast$.subscribe(() => {
            this.load()
            this.emitChange()
        })
    }

    private emitChange (): void {
        this.changed.next()
    }
}
