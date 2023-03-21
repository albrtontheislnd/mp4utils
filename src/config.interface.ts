export interface ConfigObject {
    videoExtensions: string,
    dirs: {
        scriptFile: string,
        sourcePath: string,
        destPath: string,
        joinPath: string,
    },
    birateSettings: {
        ba: number,
        bv: number,
    },
    bin: {
        ffmpeg: string,
        ffprobe: string,
        avidemux: string,
    }
}