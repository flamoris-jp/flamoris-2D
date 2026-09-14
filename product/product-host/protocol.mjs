import { Transform } from "node:stream";

export const PRODUCT_HOST_PROTOCOL_VERSION = 1;
export const MAX_CONTROL_FRAME_BYTES = 8 * 1024 * 1024;

export class ProductHostProtocolError extends Error {
  constructor(message, code = "protocol.invalid", details = {}) {
    super(message);
    this.name = "ProductHostProtocolError";
    this.code = code;
    this.details = details;
  }
}

export function encodeControlFrame(value) {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  if (payload.length > MAX_CONTROL_FRAME_BYTES) {
    throw new ProductHostProtocolError(
      "Control frame exceeds the protocol limit.",
      "protocol.frame_too_large",
      { bytes: payload.length, maximum: MAX_CONTROL_FRAME_BYTES },
    );
  }
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

export class ControlFrameDecoder extends Transform {
  constructor() {
    super({ readableObjectMode: true });
    this.buffer = Buffer.alloc(0);
  }

  _transform(chunk, _encoding, callback) {
    try {
      this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
      while (this.buffer.length >= 4) {
        const length = this.buffer.readUInt32BE(0);
        if (length > MAX_CONTROL_FRAME_BYTES) {
          throw new ProductHostProtocolError(
            "Control frame exceeds the protocol limit.",
            "protocol.frame_too_large",
            { bytes: length, maximum: MAX_CONTROL_FRAME_BYTES },
          );
        }
        if (this.buffer.length < 4 + length) break;
        const payload = this.buffer.subarray(4, 4 + length);
        this.buffer = this.buffer.subarray(4 + length);
        let value;
        try {
          value = JSON.parse(payload.toString("utf8"));
        } catch (error) {
          throw new ProductHostProtocolError(
            "Control frame is not valid JSON.",
            "protocol.json_invalid",
            { cause: error.message },
          );
        }
        this.push(value);
      }
      callback();
    } catch (error) {
      callback(error);
    }
  }

  _flush(callback) {
    if (this.buffer.length !== 0) {
      callback(new ProductHostProtocolError(
        "Control channel ended with an incomplete frame.",
        "protocol.frame_incomplete",
        { remainingBytes: this.buffer.length },
      ));
      return;
    }
    callback();
  }
}

export function writeControlFrame(stream, value) {
  return new Promise((resolve, reject) => {
    stream.write(encodeControlFrame(value), (error) => error ? reject(error) : resolve());
  });
}
