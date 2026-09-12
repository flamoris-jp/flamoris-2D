const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function readUint32(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
}

function crcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    }
    table[index] = value >>> 0;
  }
  return table;
}

const CRC_TABLE = crcTable();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

async function decompress(bytes, format) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("This runtime cannot decompress image/archive data.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function concat(parts, length) {
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
    ? left : aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function unfilterRows(source, width, height, channels) {
  const rowBytes = width * channels;
  const expected = (rowBytes + 1) * height;
  if (source.length !== expected) throw new Error("PNG scanline size is invalid.");
  const output = new Uint8Array(rowBytes * height);
  let inputOffset = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = source[inputOffset++];
    if (filter > 4) throw new Error("PNG uses an unsupported row filter.");
    const rowOffset = row * rowBytes;
    const previousOffset = rowOffset - rowBytes;
    for (let column = 0; column < rowBytes; column += 1) {
      const raw = source[inputOffset++];
      const left = column >= channels ? output[rowOffset + column - channels] : 0;
      const above = row > 0 ? output[previousOffset + column] : 0;
      const upperLeft = row > 0 && column >= channels
        ? output[previousOffset + column - channels] : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? above
            : filter === 3 ? Math.floor((left + above) / 2)
              : paeth(left, above, upperLeft);
      output[rowOffset + column] = (raw + predictor) & 0xff;
    }
  }
  return output;
}

function decodeAdam7(source, width, height, channels) {
  const passes = [
    [0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4],
    [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2],
  ];
  const output = new Uint8Array(width * height * channels);
  let offset = 0;
  for (const [startX, startY, stepX, stepY] of passes) {
    const passWidth = width <= startX ? 0 : Math.ceil((width - startX) / stepX);
    const passHeight = height <= startY ? 0 : Math.ceil((height - startY) / stepY);
    if (!passWidth || !passHeight) continue;
    const length = (passWidth * channels + 1) * passHeight;
    if (offset + length > source.length) throw new Error("PNG Adam7 data is truncated.");
    const pass = unfilterRows(source.subarray(offset, offset + length), passWidth, passHeight, channels);
    offset += length;
    for (let y = 0; y < passHeight; y += 1) {
      for (let x = 0; x < passWidth; x += 1) {
        const destination = ((startY + y * stepY) * width + startX + x * stepX) * channels;
        const input = (y * passWidth + x) * channels;
        output.set(pass.subarray(input, input + channels), destination);
      }
    }
  }
  if (offset !== source.length) throw new Error("PNG Adam7 data has trailing bytes.");
  return output;
}

export async function decodePngRaster(input, {
  expectedWidth,
  expectedHeight,
  expectedColorType,
  inflate = (bytes) => decompress(bytes, "deflate"),
} = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
  if (bytes.length < 45 || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    throw new Error("PNG signature is invalid.");
  }
  let offset = 8;
  let header = null;
  let sawEnd = false;
  const imageParts = [];
  let imageLength = 0;
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) throw new Error("PNG chunk header is truncated.");
    const length = readUint32(bytes, offset);
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = new TextDecoder("ascii").decode(typeBytes);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) throw new Error("PNG chunk exceeds the asset bounds.");
    const crcInput = bytes.subarray(offset + 4, dataEnd);
    if (crc32(crcInput) !== readUint32(bytes, dataEnd)) {
      throw new Error(`PNG ${type} checksum is invalid.`);
    }
    const data = bytes.subarray(dataStart, dataEnd);
    if (!header) {
      if (type !== "IHDR" || length !== 13) throw new Error("PNG IHDR must be first.");
      header = {
        width: readUint32(data, 0),
        height: readUint32(data, 4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === "IHDR") {
      throw new Error("PNG contains duplicate IHDR chunks.");
    } else if (type === "IDAT") {
      imageParts.push(data);
      imageLength += data.length;
    } else if (type === "IEND") {
      if (length !== 0 || sawEnd) throw new Error("PNG IEND is invalid.");
      sawEnd = true;
      offset = dataEnd + 4;
      break;
    } else if ((typeBytes[0] & 0x20) === 0) {
      throw new Error(`PNG critical chunk ${type} is unsupported.`);
    }
    offset = dataEnd + 4;
  }
  if (!header || !sawEnd || offset !== bytes.length || imageParts.length === 0) {
    throw new Error("PNG structure is incomplete.");
  }
  if (header.width !== expectedWidth || header.height !== expectedHeight) {
    throw new Error("PNG dimensions do not match the manifest.");
  }
  if (header.bitDepth !== 8 || header.colorType !== expectedColorType ||
    header.compression !== 0 || header.filter !== 0 || ![0, 1].includes(header.interlace)) {
    throw new Error("PNG pixel format is not valid for .flimg v1.");
  }
  const channels = header.colorType === 6 ? 4 : header.colorType === 0 ? 1 : 0;
  if (!channels) throw new Error("PNG color type is unsupported.");
  const compressed = concat(imageParts, imageLength);
  const inflated = await inflate(compressed);
  const pixels = header.interlace === 0
    ? unfilterRows(inflated, header.width, header.height, channels)
    : decodeAdam7(inflated, header.width, header.height, channels);
  return { width: header.width, height: header.height, colorType: header.colorType, channels, pixels };
}

export const pngInternals = Object.freeze({ decompress });
