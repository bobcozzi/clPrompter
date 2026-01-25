// (c) Copyright 2025 by Robert Cozzi, Jr.
// All rights reserved. Reproduction in whole or part is prohibited.
// Replace Buffer-based helpers with browser-safe encoders
// Encode a JS string as UTF-16BE (no BOM), returns 2*length bytes
function encodeUTF16BE(str) {
    const out = new Uint8Array(str.length * 2);
    let o = 0;
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i); // UCS-2 code unit
        out[o++] = (code >> 8) & 0xFF; // high byte first (BE)
        out[o++] = code & 0xFF; // low byte
    }
    return out;
}
// Write ASCII (or NULs) of a fixed length into buf at offset
function writeAsciiFixed(buf, offset, s, len) {
    const n = Math.min(len, s.length);
    for (let i = 0; i < n; i++)
        buf[offset + i] = s.charCodeAt(i) & 0x7F;
    for (let i = n; i < len; i++)
        buf[offset + i] = 0x00;
    return offset + len;
}
// Helper function to insure that a qualified object name
// is in true CL command qualified name format.
// It accepts either a fully qualified object name,
// such as qgpl/customter
// or an API-structure of: OBJECT....LIBRARY...
// and returns library/object to the caller.
// If only somethig like "OBJECT" is passed in (i.e., no library)
// then it is returned as "OBJECT" without a qualified library name.
export function buildQualName(input) {
    // If the input name is already a fully-qualified object name,
    // then simply round-trip it.
    if (input.includes('/')) {
        return input;
    }
    // Extract first 10 and second 10 bytes
    const part1 = input.substring(0, 10).trimEnd();
    const part2 = input.substring(10, 20).trimEnd();
    if (part2) { // return newly qualified name
        return `${part2}/${part1}`;
    }
    else { // return just the object name
        return part1;
    }
}
export function buildAPI2PartName(cmdString) {
    let cmdName = '';
    let libName = '';
    let tokens = cmdString.trim().split(/\s+/);
    if (tokens.length > 1 && tokens[0].endsWith(':')) {
        tokens.shift();
    }
    if (tokens.length > 0) {
        cmdName = tokens[0];
    }
    if (cmdName.includes('/')) {
        let [lib, name] = cmdName.split('/');
        name = name?.startsWith('"') && name.endsWith('"') ? name : name.toUpperCase();
        lib = lib?.startsWith('"') && lib.endsWith('"') ? lib : lib.toUpperCase();
        cmdName = (name || '').padEnd(10, ' ');
        libName = (lib || '').padEnd(10, ' ');
    }
    else {
        let name = cmdName;
        name = name.startsWith('"') && name.endsWith('"') ? name : name.toUpperCase();
        cmdName = name.padEnd(10, ' ');
        libName = '*LIBL'.padEnd(10, ' ');
    }
    // Return ASCII bytes (20 bytes total)
    const out = new Uint8Array(20);
    for (let i = 0; i < 10; i++)
        out[i] = (cmdName.charCodeAt(i) || 0x20) & 0x7F;
    for (let i = 0; i < 10; i++)
        out[10 + i] = (libName.charCodeAt(i) || 0x20) & 0x7F;
    return out;
}
// Accepts ASCII/UTF-8 path name and builds an IBM i Qlg_Path_Name as hex (CCSID 1200, BE, no BOM)
export function buildQlgPathNameHex(pathAndCmd) {
    // Constants per Qlg_Path_Name
    const CCSID = 1200; // UTF-16, big-endian
    const Country_ID = '\0\0'; // 2 bytes
    const Language_ID = '\0\0\0'; // 3 bytes
    const Reserved = '\0\0\0'; // 3 bytes
    const Path_Type = 2; // QLG_CHAR_DOUBLE
    const delimiter = '/';
    // Encode pieces
    const pathBytesFull = encodeUTF16BE(pathAndCmd);
    const Path_Length = Math.min(pathBytesFull.length, 4096); // bytes
    const delimBytes = encodeUTF16BE(delimiter); // 2 bytes
    // Compute total struct size
    const total = 4 // CCSID (int32 BE)
        + 2 // Country_ID
        + 3 // Language_ID
        + 3 // Reserved
        + 4 // Path_Type (uint32 BE)
        + 4 // Path_Length (int32 BE)
        + 2 // Path_Name_Delimiter (UTF-16BE wchar)
        + 10 // Reserved2
        + Path_Length; // Path_Name (UTF-16BE)
    const buf = new Uint8Array(total);
    let off = 0;
    // Write CCSID (int32 BE)
    new DataView(buf.buffer, off, 4).setInt32(0, CCSID, false);
    off += 4;
    // Country_ID (2), Language_ID (3), Reserved (3)
    off = writeAsciiFixed(buf, off, Country_ID, 2);
    off = writeAsciiFixed(buf, off, Language_ID, 3);
    off = writeAsciiFixed(buf, off, Reserved, 3);
    // Path_Type (uint32 BE)
    new DataView(buf.buffer, off, 4).setUint32(0, Path_Type, false);
    off += 4;
    // Path_Length (int32 BE) in bytes of UTF-16BE path
    new DataView(buf.buffer, off, 4).setInt32(0, Path_Length, false);
    off += 4;
    // Path_Name_Delimiter (UTF-16BE, 2 bytes)
    buf.set(delimBytes.subarray(0, 2), off);
    off += 2;
    // Reserved2 (10 bytes zeros)
    for (let i = 0; i < 10; i++)
        buf[off + i] = 0x00;
    off += 10;
    // Path_Name (UTF-16BE)
    buf.set(pathBytesFull.subarray(0, Path_Length), off);
    off += Path_Length;
    // Convert to uppercase hex
    let hex = '';
    for (let i = 0; i < buf.length; i++) {
        hex += buf[i].toString(16).padStart(2, '0').toUpperCase();
    }
    return hex;
}
//# sourceMappingURL=QlgPathName.js.map