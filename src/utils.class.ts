import { MP4UtilsConfiguration } from "./config.class.ts";
import * as path from "https://deno.land/std@0.180.0/path/mod.ts";
import * as crypto from "https://deno.land/std@0.180.0/crypto/crypto.ts";
import moo from "https://esm.sh/moo@0.5.2";
import * as _ from "https://deno.land/x/lodash@4.17.15-es/lodash.js";
import { unlinkSync } from "https://deno.land/std@0.177.0/node/fs.ts";
import { spawn } from "https://deno.land/std@0.177.0/node/child_process.ts";
import { sleep } from "https://deno.land/x/sleep@v1.2.1/mod.ts";

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

    static forceMP4Extension(filePath: string) {
        const fileExtension = path.extname(filePath).replace(/\./img, "");

        if(fileExtension !== 'mp4') {
            return `${filePath}.mp4`;
        } else {
            return filePath;
        }
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

        const runtimeEnvs = MP4UtilsConfiguration.getBinEnvs();

        let contentScriptFile = '';
        const videos: VideoFile[] = [];
        const filenamesFromScanDir: string[] = [];
        const filenamesFromScriptFile: string[] = [];

        // Scan sourcePath and add videos filenames
        // if this is legacy_join, skip!
        if(!runtimeEnvs.legacy_join) {
            filenamesFromScanDir.push(...this.processSourceDir());
        }

        try {
            contentScriptFile = (new TextDecoder("utf-8")).decode(Deno.readFileSync(this.configService.getScriptFile()));
        } catch (e) {
            console.log(`CANNOT OPEN SCRIPT FILE: ${this.configService.getScriptFile()}
            ERROR: ${e}`);
        }

        const linebyLine = contentScriptFile.split(/\r?\n/);

        for await (const line of linebyLine) {
            const a = await this.processScriptLine(this.parseScriptLine(line));
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
        filenames.forEach((elm: string) => {
            const child = new VideoFile(false, defaultSettings, false);
            child.inputFileName = elm;
            videos.push(child);
        });

        return videos;
    }

    // deno-lint-ignore require-await
    async processScriptLine(tokens: moo.Token[]): Promise<LineObjectsResult> {

        const runtimeEnvs = MP4UtilsConfiguration.getBinEnvs();

        let videoBitrate = this.configService.getAll().birateSettings.bv;
        let audioBirate = this.configService.getAll().birateSettings.ba;
        let joinFileName = '';
        const childFileName: string[] = [];
        const videoFileObjects: VideoFile[] = [];
        // define defaultSettings
        const defaultSettings: DefaultVideoFileSettings = {
            ba: audioBirate,
            bv: videoBitrate,
            sourcePath: this.configService.getAll().dirs.sourcePath,
            destPath: this.configService.getAll().dirs.destPath,
            joinPath: this.configService.getAll().dirs.joinPath,
        };

        for (const element of tokens) {
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

        const addtoArray = (isChild = false) => {
            childFileName.forEach(element => {
                const child = new VideoFile(false, defaultSettings);
                child.inputFileName = element;
                
                if(isChild) {
                    if(!runtimeEnvs.legacy_join || (runtimeEnvs.legacy_join && child.isOutputFileExists())) {
                        // if legacy_join, we check file existing!
                        videoFileObjects[0].addChild(child);
                    }
                } else {
                    videoFileObjects.push(child);
                }
            });
        };

        if((runtimeEnvs.legacy_convert && joinFileName.length > 0) || (runtimeEnvs.legacy_join && joinFileName.length == 0)) {
            return {
                videos: [],
                filenames: [],
            };
        }

        if(joinFileName.length > 0) {
            videoFileObjects[0] = new VideoFile(true, defaultSettings);
            videoFileObjects[0].inputFileName = joinFileName;
            addtoArray(true);
        } else {
            addtoArray(false);
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
            
            const outStr = new TextDecoder('utf-8').decode(await p.output());
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

    // deno-lint-ignore no-explicit-any
    static async spawnExec(cmd: string, args: any): Promise<any> {
        let running = true;
        let content = '';
        let exitCode = 1;

        try {
            const sub = spawn(cmd, args);

            sub?.on('error', (e) => {
                const x = e.toString();
                content = `${content}\r\n${x}`;
                console.log(`Failed to start ${cmd}.`);
                throw 1;
            });

            sub?.stdout?.on('data', function (data) {
                const x = data.toString();
                // content = `${content}\r\n${x}`;
                console.log(x);
            });
        
            sub?.stderr?.on('data', function (data) {
                const x = data.toString();
                content = `${content}\r\n${x}`;
                console.log(x);
            });
        
            sub?.on('exit', function (code) {
                const x = 'child process exited with code ' + code.toString();
                content = `${content}\r\n${x}`;
                console.log(x);
                exitCode = Number(code);
                running = false;
            });

            while(running == true) {
                await sleep(2);
    
                if(!running) {
                    try {
                        sub.disconnect();
                        sub.kill();
                        sub.unref();
                    } catch { 
                        console.log(``);
                    }
                    break;
                }
            }
        } catch (error) {
            running = false;
            exitCode = 1;
            console.log(`SUBPROCESS ERROR: ${error}`);
        }

        return {
            output: content,
            exitCode: exitCode,
        };

    }
}

// script file format
