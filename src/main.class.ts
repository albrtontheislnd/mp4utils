import { MP4UtilsConfiguration } from "./config.class.ts";
import { MP4UtilsFunctions } from "./utils.class.ts";
import { VideoFile } from "./videofile.class.ts";
import * as _ from "https://deno.land/x/lodash@4.17.15-es/lodash.js";
import { Command } from "https://deno.land/x/cliffy@v0.25.7/command/mod.ts";
import { Table, Cell } from "https://deno.land/x/cliffy@v0.25.7/table/mod.ts";
import { colors } from "https://deno.land/x/cliffy@v0.25.7/ansi/colors.ts";
import { Confirm } from "https://deno.land/x/cliffy@v0.25.7/prompt/mod.ts";
import path from "https://deno.land/std@0.177.0/node/path.ts";


export class MP4UtilsMain {

    private readonly configService: MP4UtilsConfiguration;
    private readonly utilsService: MP4UtilsFunctions;
    private videos: VideoFile[] = [];

    constructor() {
        this.configService = new MP4UtilsConfiguration();
        this.utilsService = new MP4UtilsFunctions(this.configService);
    }

    async init() {
        // create Commands
        await new Command().name("mp4utils")
        .description("Command line app for convert/join videos")
        // deno-lint-ignore no-unused-vars
        .action(async (options, ...args) => {
            this.videos = await this.utilsService.processScriptFile();
            await this.exec();
        })        
        // join        
        .parse(Deno.args);
    }

    async exec() {
        const confirm = await this.displayTableConvert();
        if(!confirm) return;

        for await (const videoItem of this.videos) {
            await videoItem.doConvert();
            //console.log(videoItem.isSuccessful(), videoItem.getStatus());
        }

        // clean up!
        await this.filesCleanUp();
    }

    async displayTableConvert(): Promise<boolean> {
        const info = colors.bold.blue;
        console.log(info.underline("[INFO]"), "Files scanned by the app:");

        const tableItems = await this.generateTableItems();

        new Table()
        .header(["Input", "Output", "Video Bitrate", "Audio Bitrate"])
        .body(tableItems)
        .maxColWidth(30)
        .padding(1)
        .indent(2)
        .border(true)
        .render();

        // ask for confirmation
        const confirmation = await Confirm.prompt(`Do you want to continue?`);

        return confirmation;
    }

    async generateTableItems() {
        const tableItems = [];
        for await (const videoItem of this.videos) {
            if(videoItem.isJoinFileName) {
                tableItems.push(
                    [new Cell(`JOIN/MERGE INTO: ${videoItem.outputFilePath}`).colSpan(4)],
                );

                for await (const childItem of videoItem.getChildren()) {
                    // check Exists here!!!
                    if(!childItem.isInputFileExists()) continue;
                    // check Exists here!!!
                    tableItems.push([
                        childItem.inputFilePath,
                        childItem.outputFilePath,
                        childItem.videoBitrate.toString(),
                        childItem.audioBitrate.toString(),
                    ]);
                }

                tableItems.push(
                    [new Cell(`END /./`).colSpan(4)],
                );
            } else {
                // check Exists here!!!
                if(!videoItem.isInputFileExists()) continue;
                // check Exists here!!!
                tableItems.push([
                    `(SINGLE) ${videoItem.inputFilePath}`,
                    `(SINGLE) ${videoItem.outputFilePath}`,
                    videoItem.videoBitrate,
                    videoItem.audioBitrate
                ]);
            }
        }

        return tableItems;
    }

    async filesCleanUp() {
        // get all files from sourceDir
        let filenamesFromScanDir: string[] = [];
        let filenamesToDelete: string[] = [];
        filenamesFromScanDir.push(...this.utilsService.processSourceDir());

        const checkFile = (item: VideoFile, isChild = false) => {
            if(item.isSuccessful()) { // successfully converted
                // add to filenamesToDelete
                filenamesToDelete.push(item.inputFileName);
                // remove from filenamesFromScanDir
                filenamesFromScanDir = _.without(filenamesFromScanDir, item.inputFileName);

                // isChild == true
                if(isChild) {
                    MP4UtilsFunctions.deleteFile(item.outputFilePath);
                }
            } else {
                // don't delete inputFile, cleanup OutputFile
                filenamesFromScanDir.push(item.inputFileName);
                filenamesToDelete = _.without(filenamesToDelete, item.inputFileName);
                MP4UtilsFunctions.deleteFile(item.outputFilePath);
            } 
        }
        
        for await (const videoItem of this.videos) {
            if(!videoItem.isJoinFileName) {
                checkFile(videoItem);
            } else {
                // this is a JOIN file                
                if(!videoItem.isSuccessful()) {
                    MP4UtilsFunctions.deleteFile(videoItem.outputFilePath);
                }

                for await (const childItem of videoItem.getChildren()) {
                    checkFile(childItem, true);
                }
            }
        }

        filenamesFromScanDir = _.uniq(filenamesFromScanDir);
        filenamesToDelete = _.uniq(filenamesToDelete);

        // delete files
        filenamesToDelete.forEach(fileName => {
            const filePath = path.resolve(this.configService.getSourcePath(), fileName);
            MP4UtilsFunctions.deleteFile(filePath);
            console.log(`DELETED: ${filePath}`);
        });

        // keep files
        const filenames = _.difference(filenamesFromScanDir, filenamesToDelete);
        filenames.forEach((fileName: string) => {
            const filePath = path.resolve(this.configService.getSourcePath(), fileName);
            console.log(`KEPT: ${filePath}`);  
        });


        console.log(`CLEANED UP ALL FILES!`);
    }
}