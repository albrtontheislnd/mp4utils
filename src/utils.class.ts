import { MP4UtilsConfiguration } from "./config.class.ts";
import * as path from "https://deno.land/std@0.180.0/path/mod.ts";
import * as crypto from "https://deno.land/std@0.180.0/crypto/crypto.ts";
import moo from "https://esm.sh/moo@0.5.2";
import * as _ from "https://deno.land/x/lodash@4.17.15-es/lodash.js";
import { unlinkSync } from "https://deno.land/std@0.177.0/node/fs.ts";

import { DefaultVideoFileSettings, LineObjectsResult, VideoFile } from "./videofile.class.ts";

export class MP4UtilsFunctions {
    constructor(
        private readonly configService: MP4UtilsConfiguration,
    ) {

    }

    getFileExtension(filePath: string, onlyAcceptVideo = false) {
        const fileExtension = path.extname(filePath).toLowerCase().replace(/\./img, "");

        if(onlyAcceptVideo) {
            const videoExtensions = this.configService.getVideoExtensions();
            return (videoExtensions.includes(fileExtension)) ? fileExtension : false;
        } else {
            return (fileExtension.length > 0) ? fileExtension : false;
        }
      }

    static autoAppendFileExtension(filePath: string, forcedExtension = "mp4") {
        const fileExtension = path.extname(filePath).replace(/\./img, "");
        return (fileExtension.length == 0) ? `${filePath}.${forcedExtension}` : filePath;
    }

    static autoAppendRandomString(filePath: string) {
        const filePathObject = path.parse(filePath);
        const hashHex = crypto.crypto.randomUUID().replace(/[^\da-zA-Z]/ig, "").slice(0, 8);
        const newfileName = `${filePathObject.name}_${hashHex}${filePathObject.ext}`;
        return newfileName;
    }

    processSourceDir(): string[] {
        const filenames: string[] = [];
        // get list of video files in Source Directory FOR CONVERTING
        for (const dirEntry of Deno.readDirSync(this.configService.getSourcePath())) {
            if(dirEntry.isFile && !dirEntry.isSymlink && this.getFileExtension(dirEntry.name, true) != false) {
                filenames.push(dirEntry.name);
            }
        }

        return filenames;
    }

    async processScriptFile(): Promise<VideoFile[]> {
        let contentScriptFile = '';
        const videos: VideoFile[] = [];
        const filenamesFromScanDir: string[] = [];
        const filenamesFromScriptFile: string[] = [];

        // Scan sourcePath and add videos filenames
        filenamesFromScanDir.push(...this.processSourceDir());

        try {
            const decoder = new TextDecoder("utf-8");
            const data = Deno.readFileSync(this.configService.getScriptFile());
            contentScriptFile = decoder.decode(data);
        } catch (e) {
            console.log(`CANNOT OPEN SCRIPT FILE: ${this.configService.getScriptFile()}
            ERROR: ${e}`);
        }

        const linebyLine = contentScriptFile.split(/\r?\n/);
        

        for (let index = 0; index < linebyLine.length; index++) {
            const line = linebyLine[index];
            const tokens = this.parseScriptLine(line);
            const a = await this.processScriptLine(tokens);
            videos.push(...a.videos);
            filenamesFromScriptFile.push(...a.filenames);
        }

        // Select files in filenamesFromScanDir, but not in filenamesFromScriptFile
        // define defaultSettings
        const defaultSettings: DefaultVideoFileSettings = {
            ba: this.configService.getAll().birateSettings.ba,
            bv: this.configService.getAll().birateSettings.bv,
            sourcePath: this.configService.getAll().dirs.sourcePath,
            destPath: this.configService.getAll().dirs.destPath,
            joinPath: this.configService.getAll().dirs.joinPath,
        };
        const filenames = _.difference(filenamesFromScanDir, filenamesFromScriptFile);

        filenames.forEach((element: string) => {
            const child = new VideoFile(false, defaultSettings, false);
            child.inputFileName = element;
            videos.push(child);
        });

        return videos;
    }

    // deno-lint-ignore require-await
    async processScriptLine(tokens: moo.Token[]): Promise<LineObjectsResult> {

        let videoBitrate = this.configService.getAll().birateSettings.bv;
        let audioBirate = this.configService.getAll().birateSettings.ba;
        let joinFileName = '';
        const childFileName: string[] = [];
        const videoFileObjects: VideoFile[] = [];

        for (let index = 0; index < tokens.length; index++) {
            const element = tokens[index];

            switch (element?.type) {
                case 'videoBirate':
                    videoBitrate = parseInt(element.value);
                break;

                case 'audioBirate':
                    audioBirate = parseInt(element.value);
                break;

                case 'joinFileName':
                    joinFileName = MP4UtilsFunctions.autoAppendFileExtension(element.value);
                break;

                case 'childFileName':
                    childFileName.push(MP4UtilsFunctions.autoAppendFileExtension(element.value));
                break;

                default:
                break;
            }
        }

        // define defaultSettings
        const defaultSettings: DefaultVideoFileSettings = {
            ba: audioBirate,
            bv: videoBitrate,
            sourcePath: this.configService.getAll().dirs.sourcePath,
            destPath: this.configService.getAll().dirs.destPath,
            joinPath: this.configService.getAll().dirs.joinPath,
        };

        if(joinFileName.length > 0) {
            // this is a JOIN file!!!
            const videoFileObject = new VideoFile(true, defaultSettings);            
            videoFileObject.inputFileName = joinFileName;

            // add children
            childFileName.forEach(element => {
                const child = new VideoFile(false, defaultSettings);
                child.inputFileName = element;
                videoFileObject.addChild(child);
            });

            videoFileObjects.push(videoFileObject);
        } else {
            // just an video item
            childFileName.forEach(element => {
                const child = new VideoFile(false, defaultSettings, false);
                child.inputFileName = element;
                videoFileObjects.push(child);
            });
        }

        return {
            videos: videoFileObjects,
            filenames: childFileName,
        };
    }

    parseScriptLine(line = '') {
        const lexer = moo.states({
            main: {
                videoBirate: {
                    match: /bv:[\d]+/, 
                    value: s => {
                        return s.replace(/\D/ig, "");
                    },
                    //push: 'lit'
                    },
                audioBirate: {
                    match: /ba:[\d]+/, 
                    value: s => {
                        return s.replace(/\D/ig, "");
                    },
                    //push: 'lit'
                    },
                joinFileName: {
                    match: /[._\da-zA-Z-]+/,
                    value: s => {
                        s = MP4UtilsFunctions.autoAppendFileExtension(s);
                        return s;
                    }
                },
                sep: {
                    match: ' | ',
                    next: 'files'
                },
                space:    {
                    match: /\s+/, 
                    lineBreaks: true
                },
                myError: moo.error,
            },
            files: {
                childFileName: {
                    match: /[._\da-zA-Z-]+/,
                    value: s => {
                        s = MP4UtilsFunctions.autoAppendFileExtension(s);
                        return s;
                    }
                },
                space:    {
                    match: /\s+/, 
                    lineBreaks: true
                },
                myError: moo.error,
            },
          });

        lexer.reset(line);
        return Array.from(lexer);
    }

    // deno-lint-ignore no-explicit-any
    static async execCaptureOutput(cmd: any): Promise<string | null> {
        try {
            const p = Deno.run({
                cmd: cmd,
                stdout: "piped",
                stderr: "piped",
              });
        
            const outStr = new TextDecoder('utf-8').decode(await p.output()); // hello
            p.close();
            return outStr;
        } catch (error) {
            console.log(error);
            return null;
        }
    }

    static deleteFile(filePath: string) {
        // deno-lint-ignore no-unused-vars
        try { unlinkSync(filePath) } catch(err) { console.log(``) }
        return;
    }
}

// script file format
