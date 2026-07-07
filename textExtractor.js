const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const xlsx = require('xlsx');
const exifParser = require('exif-parser');
const musicMetadata = require('music-metadata');
const AdmZip = require('adm-zip');

class TextExtractor {
  async extractText(filePath, maxChars = 500) {
    const ext = path.extname(filePath).toLowerCase();
    let text = '';

    try {
      if (!fs.existsSync(filePath)) {
        return '';
      }

      // Check file size
      const stats = fs.statSync(filePath);
      const fileSizeMB = stats.size / (1024 * 1024);

      // Simple metadata header
      let metaInfo = `File Name: ${path.basename(filePath)}\nFile Size: ${fileSizeMB.toFixed(2)} MB\n`;

      switch (ext) {
        case '.pdf':
          text = await this.extractPDF(filePath);
          break;
        case '.docx':
          text = await this.extractDOCX(filePath);
          break;
        case '.xlsx':
        case '.xls':
          text = await this.extractXLSX(filePath);
          break;
        case '.csv':
        case '.txt':
        case '.md':
        case '.json':
        case '.xml':
        case '.html':
          text = await this.extractTextFile(filePath, maxChars * 2);
          break;
        case '.jpg':
        case '.jpeg':
        case '.png':
          text = await this.extractImageMetadata(filePath);
          break;
        case '.mp3':
        case '.mp4':
        case '.m4a':
        case '.wav':
          text = await this.extractMediaMetadata(filePath);
          break;
        case '.zip':
          text = await this.extractZipContents(filePath);
          break;
        case '.pptx':
          text = await this.extractPPTX(filePath);
          break;
        case '.exe':
          text = await this.extractExeMetadata(filePath);
          break;
        default:
          text = `Generic file metadata. Created: ${stats.birthtime.toISOString()}, Modified: ${stats.mtime.toISOString()}`;
          break;
      }

      // Combine metadata and content, slice to max characters
      const combined = `${metaInfo}\nContent/Metadata:\n${text}`;
      return combined.substring(0, maxChars);
    } catch (e) {
      console.error(`Extraction failed for ${filePath}:`, e);
      // Fallback: use just file name and basic statistics
      try {
        const stats = fs.statSync(filePath);
        return `File Name: ${path.basename(filePath)}\nSize: ${(stats.size / 1024).toFixed(1)} KB\nExtraction error fallback.`;
      } catch (err) {
        return `File Name: ${path.basename(filePath)}\nError: file unreadable.`;
      }
    }
  }

  async extractPDF(filePath) {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    return data.text || '';
  }

  async extractDOCX(filePath) {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value || '';
  }

  async extractXLSX(filePath) {
    const workbook = xlsx.readFile(filePath);
    let sheetText = [];
    const sheetNames = workbook.SheetNames.slice(0, 3);
    for (const sheetName of sheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const csv = xlsx.utils.sheet_to_csv(worksheet, { maxRows: 50 });
      sheetText.push(`Sheet: ${sheetName}\n${csv}`);
    }
    return sheetText.join('\n\n');
  }

  async extractTextFile(filePath, readLen) {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(readLen);
    const bytesRead = fs.readSync(fd, buffer, 0, readLen, 0);
    fs.closeSync(fd);
    return buffer.toString('utf8', 0, bytesRead);
  }

  async extractImageMetadata(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    let metaString = '';
    
    if (ext === '.jpg' || ext === '.jpeg') {
      try {
        const buffer = fs.readFileSync(filePath);
        const parser = exifParser.create(buffer);
        const result = parser.parse();
        if (result.tags) {
          metaString += Object.entries(result.tags)
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ');
        }
      } catch (e) {
        metaString += 'No EXIF metadata. ';
      }
    }
    
    const stats = fs.statSync(filePath);
    metaString += `Modified: ${stats.mtime.toISOString()}`;
    return metaString;
  }

  async extractMediaMetadata(filePath) {
    try {
      const metadata = await musicMetadata.parseFile(filePath, { duration: true });
      let info = [];
      if (metadata.common) {
        const { title, artist, album, genre, year } = metadata.common;
        if (title) info.push(`Title: ${title}`);
        if (artist) info.push(`Artist: ${artist}`);
        if (album) info.push(`Album: ${album}`);
        if (genre) info.push(`Genre: ${genre}`);
        if (year) info.push(`Year: ${year}`);
      }
      if (metadata.format && metadata.format.duration) {
        info.push(`Duration: ${Math.round(metadata.format.duration)}s`);
      }
      return info.join(', ') || 'No media tags found';
    } catch (e) {
      return 'Failed to parse media metadata';
    }
  }

  async extractZipContents(filePath) {
    try {
      const zip = new AdmZip(filePath);
      const zipEntries = zip.getEntries();
      const files = zipEntries.slice(0, 20).map(entry => entry.entryName);
      return `ZIP contents (first 20 files):\n${files.join('\n')}`;
    } catch (e) {
      return 'Failed to read ZIP contents';
    }
  }

  async extractPPTX(filePath) {
    try {
      const zip = new AdmZip(filePath);
      const slideEntries = zip.getEntries()
        .filter(entry => /^ppt\/slides\/slide\d+\.xml$/i.test(entry.entryName))
        .slice(0, 15);

      const slideTexts = [];
      for (const entry of slideEntries) {
        const xml = entry.getData().toString('utf8');
        const matches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || [];
        const slideText = matches
          .map(m => m.replace(/<[^>]+>/g, '').trim())
          .filter(Boolean)
          .join(' ');
        if (slideText) slideTexts.push(slideText);
      }

      if (slideTexts.length === 0) {
        return 'PowerPoint presentation (no extractable slide text)';
      }
      return `Slides (${slideTexts.length}):\n${slideTexts.join('\n\n')}`;
    } catch (e) {
      return 'Failed to read PPTX contents';
    }
  }

  async extractExeMetadata(filePath) {
    try {
      const buffer = fs.readFileSync(filePath);
      const info = [];
      const versionKeys = [
        'FileDescription',
        'ProductName',
        'CompanyName',
        'OriginalFilename',
        'InternalName',
        'LegalCopyright'
      ];

      for (const key of versionKeys) {
        const value = this.readPeVersionString(buffer, key);
        if (value) info.push(`${key}: ${value}`);
      }

      if (info.length > 0) {
        return info.join('\n');
      }

      return 'Windows executable (no version metadata found)';
    } catch (e) {
      return 'Failed to read executable metadata';
    }
  }

  readPeVersionString(buffer, key) {
    const keyBuf = Buffer.from(`${key}\0`, 'utf16le');
    const idx = buffer.indexOf(keyBuf);
    if (idx === -1) return null;

    let start = idx + keyBuf.length;
    while (start < buffer.length - 1 && buffer[start] === 0 && buffer[start + 1] === 0) {
      start += 2;
    }

    const chars = [];
    for (let i = start; i < buffer.length - 1; i += 2) {
      const code = buffer.readUInt16LE(i);
      if (code === 0) break;
      if (code >= 32 && code <= 126) {
        chars.push(String.fromCharCode(code));
      } else if (code > 127) {
        chars.push(String.fromCharCode(code));
      } else {
        break;
      }
    }

    const value = chars.join('').trim();
    return value.length >= 2 ? value : null;
  }
}

module.exports = new TextExtractor();
