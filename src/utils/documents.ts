import { PDFParse } from "pdf-parse";

export interface ParsedDocument {
    content: string;
    filename: string;
    fileType: string;
}

const SUPPORTED_EXTENSIONS = [".pdf", ".txt", ".md", ".markdown", ".text", ".log", ".json", ".xml", ".csv", ".html", ".htm"];

export function isSupportedFile(filename: string): boolean {
    const ext = filename.toLowerCase().substring(filename.lastIndexOf("."));
    return SUPPORTED_EXTENSIONS.includes(ext);
}

export function getFileType(filename: string): string {
    const ext = filename.toLowerCase().substring(filename.lastIndexOf("."));
    return ext.replace(".", "") || "txt";
}

export async function parseDocument(
    buffer: Buffer,
    filename: string
): Promise<ParsedDocument> {
    const fileType = getFileType(filename);

    if (fileType === "pdf") {
        return parsePDF(buffer, filename);
    }

    // For text-based files, just decode as UTF-8
    return {
        content: buffer.toString("utf-8"),
        filename,
        fileType,
    };
}

async function parsePDF(buffer: Buffer, filename: string): Promise<ParsedDocument> {
    try {
        const result = await pdfParse(buffer);

        if (!result.text || result.text.trim().length === 0) {
            throw new Error("No text content could be extracted from the PDF. It may be an image-based PDF.");
        }

        return {
            content: result.text.trim(),
            filename,
            fileType: "pdf",
        };
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(`Failed to parse PDF: ${error.message}`);
        }
        throw new Error("Failed to parse PDF: Unknown error");
    }
}

export async function downloadAndParse(url: string, filename: string): Promise<ParsedDocument> {
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return parseDocument(buffer, filename);
}

export function getSupportedExtensions(): string[] {
    return SUPPORTED_EXTENSIONS;
}
