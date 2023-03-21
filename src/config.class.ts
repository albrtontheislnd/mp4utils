import { cosmiconfigSync } from "https://esm.sh/cosmiconfig@8.1.2";
import { fileURLToPath } from "https://deno.land/std@0.177.0/node/url.ts";
import * as path from "https://deno.land/std@0.180.0/path/mod.ts";
import { ConfigObject } from "./config.interface.ts";

export class MP4UtilsConfiguration {

    private configObject: ConfigObject;
    private configFile = '';
    private videoExtensions: string[] = [];

    constructor() {
        this.configFile = fileURLToPath(import.meta.resolve("../main.yaml"));
        this.configObject = cosmiconfigSync('main').load(this.configFile)?.config;
        this.videoExtensions = this.configObject.videoExtensions.toLowerCase().replace(/[^,\da-zA-Z]/img, "").split(/,/im).filter(word => word.length >= 3);
        
        this.setBinEnvs();
    }

    getAll() {
        return this.configObject;
    }

    getVideoExtensions(): string[] {
        return this.videoExtensions;
    }

    getScriptFile() {
        return this.configObject.dirs.scriptFile;
    }

    getSourcePath() {
        return path.resolve(this.configObject.dirs.sourcePath);
    }

    setBinEnvs() {
        Deno.env.set("MP4UTILS_BIN_FFMPEG", this.configObject.bin.ffmpeg);
        Deno.env.set("MP4UTILS_BIN_FFPROBE", this.configObject.bin.ffprobe);
        Deno.env.set("MP4UTILS_BIN_AVIDEMUX", this.configObject.bin.avidemux);
    }
}