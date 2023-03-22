import * as path from "https://deno.land/std@0.180.0/path/mod.ts";
import { colors } from "https://deno.land/x/cliffy@v0.25.7/ansi/colors.ts";
// import { execSync } from "https://deno.land/std@0.177.0/node/child_process.ts";
import { unlinkSync } from "https://deno.land/std@0.177.0/node/fs.ts";
import { MP4UtilsFunctions } from "./utils.class.ts";

export enum VideoFileStatus {
  blank,
  successful,
  inputFileDoesNotExist,
  ffmpegError,
  joinError,
}

export interface LineObjectsResult {
  videos: VideoFile[],
  filenames: string[],
}

export interface DefaultVideoFileSettings {
  sourcePath: string,
  destPath: string,
  joinPath: string,
  ba: number,
  bv: number,
}

export class VideoFile {

    private _inputFileName = '';
    private _outputFileName = '';
    private _originalFileName = ''; // only for tracking joining files
    private _children: VideoFile[] = [];
    private _isJoinFileName = false;
    private _success = false;
    private _status: VideoFileStatus =  VideoFileStatus.blank;
    private readonly _defaultSettings: DefaultVideoFileSettings;
    private readonly _randomHex: boolean;

    private videoWidth: number|undefined;
    private videoHeight: number|undefined;
    private videoScaleFactor: string|undefined;

    constructor(isJoin: boolean = false, defaultSettings: DefaultVideoFileSettings, randomHex: boolean = true) {

      this._isJoinFileName = isJoin;
      this._randomHex = randomHex;
      this._defaultSettings = defaultSettings;

      // this.del = o.del;
    }

    set inputFileName(value: string) {
      value = MP4UtilsFunctions.autoAppendFileExtension(value);
      this._inputFileName = value;
      this._originalFileName = value;

      // auto-generate outputFileName
      if(this._isJoinFileName) {
        this._outputFileName = this._inputFileName;
      } else {
        this._outputFileName = (this._randomHex) ? MP4UtilsFunctions.autoAppendRandomString(this._inputFileName) : this._inputFileName;
      } 
    }
    get inputFileName() { return this._inputFileName }

    get originalFilePath() {
      const value = path.resolve(this._defaultSettings.sourcePath, this._originalFileName);
      return value;
    }

    get inputFilePath() {
      const value = path.resolve(this._defaultSettings.sourcePath, this._inputFileName);
      return value;
    }

    get outputFilePath() {
      const value = path.resolve((this._isJoinFileName ? this._defaultSettings.joinPath : this._defaultSettings.destPath), this._outputFileName);
      return value;
    }

    addChild(value: VideoFile) {
      this._children.push(value);
    }

    getChildren() { return this._children }

    get isJoinFileName() {
      return this._isJoinFileName;
    }

    get audioBitrate() { return this._defaultSettings.ba }
    get videoBitrate() { return this._defaultSettings.bv }

    isInputFileExists() {
        return this.checkFileExists(this.inputFilePath);
    }

    isOutputFileExists() {
      return this.checkFileExists(this.outputFilePath);
    }

    isSuccessful() {
      return this._success;
    }

    setStatus(isSuccessful = false, status: VideoFileStatus = VideoFileStatus.blank) {
      this._success = isSuccessful;
      this._status = status;
    }

    setStatusChildren(isSuccessful = false, status: VideoFileStatus = VideoFileStatus.blank) {
      this._children.forEach(element => {
        element.setStatus(isSuccessful, status);
      });
    }

    getStatus(): VideoFileStatus {
      return this._status;
    }

    private checkFileExists(filePath: string) {
      try {
        const fileInfo = Deno.lstatSync(filePath);
        return (fileInfo.isFile === true && !fileInfo.isSymlink) ? true : false;
      } catch { return false }
    }

    private computeScaleFactor(width: number, height:number) {
      const dim = {
        width: width,
        height: height
      };

      const ar = Number((dim.width / dim.height).toFixed(1));
      let x = '';

      if(ar == 1.7) {
        x = 'scale=854x480:flags=lanczos';
      } else {
          if(dim.width <= 854 && dim.height <= 480) {
              const rw = 854 / dim.width;
              const rh = 480 / dim.height;
              const r = (rw <= rh) ? rw : rh;
              x = `scale=${Math.trunc((dim.width * r))}:${Math.trunc((dim.height * r))}:force_original_aspect_ratio=increase,pad=854:480:(ow-iw)/2:(oh-ih)/2`;
          } else {
              x = 'scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2';
          }
      }

      // define
      this.videoHeight = dim.height;
      this.videoWidth = dim.width;
      this.videoScaleFactor = x;

      return true;
    }

    private async extractVideoDimensions() {
      // ffprobe -v error -hide_banner -of default=noprint_wrappers=0 -select_streams v:0 -show_format simpsons_1080p2398_clip.mp4
      const p = await MP4UtilsFunctions.execCaptureOutput([
        <string>Deno.env.get("MP4UTILS_BIN_FFPROBE"),
        '-hide_banner',
        '-print_format', 'json',
        '-show_streams',
        '-loglevel', '0',
        '-i', this.inputFilePath
      ]);

      try {
        if(p === null) throw 0;

        const obj = JSON.parse(p);
        const width = Number(obj?.streams[0]?.width);
        const height = Number(obj?.streams[0]?.height);

        if(isNaN(width) || isNaN(height)) throw 'Invalid dimensions';

        this.computeScaleFactor(width, height);
      } catch {
        return false;
      }

      return true;
    }

    async doConvert() {
      // announce!
      if(!this.isJoinFileName) {

        if(!this.isInputFileExists()) {
          console.log(colors.bgBlack.red(`ERROR! NOT FOUND ${this.inputFilePath}`));
          this.setStatus(false, VideoFileStatus.inputFileDoesNotExist);
          return;
        } else {
          console.log(colors.bgBlack.brightYellow(`Converting ${this.inputFilePath} ==> ${this.outputFilePath}`));
        }

        // check vid dims
        const checkDims = await this.extractVideoDimensions();
        if(!checkDims) {
          console.log(colors.bgBlack.red(`ERROR! Can't obtain video dimensions for ${this.inputFilePath}`));
          return;
        }

        // convert
        console.log(`=========================================================================================`);
        console.log(`Converting: ${this.inputFilePath}`);

        const cmd_str = `${<string>Deno.env.get("MP4UTILS_BIN_FFMPEG")} -i "${this.inputFilePath}" -hide_banner -r 24 -vf "${this.videoScaleFactor}" -c:v libx264 -b:v ${this._defaultSettings.bv}k -c:a aac -b:a ${this._defaultSettings.ba}k -ar 44100 -ac 2 -filter:a "loudnorm" -tune zerolatency -preset veryfast -movflags +faststart -y "${this.outputFilePath}"`;
        // deno-lint-ignore no-explicit-any
        const args: any[] = [
          '-i', this.inputFilePath,
          '-hide_banner',
          '-r', '24',
          '-vf', this.videoScaleFactor,
          '-c:v', 'libx264',
          '-b:v', `${this._defaultSettings.bv}k`,
          '-c:a', 'aac',
          '-b:a', `${this._defaultSettings.ba}k`,
          '-ar', '44100',
          '-ac', '2',
          '-filter:a', 'loudnorm',
          '-tune', 'zerolatency',
          '-preset', 'veryfast',
          '-movflags', '+faststart',
          '-y', this.outputFilePath,
        ];

        console.log(`DEBUG: ${cmd_str}`);

        try {
          //execSync(cmd_str, {stdio: 'inherit'});
          const outputRs = await MP4UtilsFunctions.spawnExec(<string>Deno.env.get("MP4UTILS_BIN_FFMPEG"), args);
          if(outputRs?.exitCode != 0) {
            throw `Error with Exit Code: ${outputRs?.exitCode}`;
          }
          this.setStatus(true, VideoFileStatus.successful);
        } catch(e) {
          console.log(colors.bgBrightRed.black(`ERROR: ${e}`));
          this.setStatus(false, VideoFileStatus.ffmpegError);
        }

      } else {
        // THIS IS JOIN FILE!
        // Track children statuses
        let index = 0;
        let fails = 0;
        let ArgumentList = `${<string>Deno.env.get("MP4UTILS_BIN_AVIDEMUX")} `;
        // deno-lint-ignore no-explicit-any
        const args: any[] = [];

        for await (const childVideo of this._children) {
          
          await childVideo.doConvert();

          if(!childVideo.isSuccessful()) {
            fails = fails + 1;
          } else {
            ArgumentList += (index == 0) ? `--load "${childVideo.outputFilePath}" ` : `--append "${childVideo.outputFilePath}" `;
            if(index == 0) {
              args.push('--load', childVideo.outputFilePath);
            } else {
              args.push('--append', childVideo.outputFilePath);
            }
          }

          index = index + 1;
        }

        if(fails > 0) {
          console.log(colors.bgBlack.red(`ERROR! ERROR MERGING FILE ${this.outputFilePath}`));
          console.log(colors.bgBlack.red(`Reason: ${fails} video conversion(s) failed.`));
          this.setStatus(false, VideoFileStatus.joinError);
          return;
        }

        // begin JOIN!
        ArgumentList += ` --video-codec copy --audio-codec copy --output-format mp4 --save "${this.outputFilePath}"`;
        console.log(ArgumentList);
        args.push('--video-codec', 'copy', '--audio-codec', 'copy', '--output-format', 'mp4', '--save', this.outputFilePath);

        // Delete old master file before joining
        try { unlinkSync(this.outputFilePath); } catch { console.log(``) }

        // Join
        try {
          //execSync(ArgumentList, {stdio: 'inherit'});
          const outputRs = await MP4UtilsFunctions.spawnExec(<string>Deno.env.get("MP4UTILS_BIN_AVIDEMUX"), args);
          //console.log(colors.bgBrightCyan(outputRs?.output));
          if(outputRs?.exitCode != 0) {
            throw `Error with Exit Code: ${outputRs?.exitCode}`;
          }
          
          // success!
          this.setStatus(true, VideoFileStatus.successful);
          this.setStatusChildren(true, VideoFileStatus.successful);
          console.log(`SUCCESSFULLY JOINED/MERGED INTO FILE ${this.outputFilePath}`);
        } catch(e) {
          // failed
          this.setStatus(false, VideoFileStatus.joinError);
          this.setStatusChildren(false, VideoFileStatus.joinError);
          console.log(`ERROR MERGING FILE ${this.outputFilePath}: ${e}`);
          console.log('No original files will be deleted because of the setting or there was at least one failed joining task.');
        }
        

      }
      
      
      //
    }
  }