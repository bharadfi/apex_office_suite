import { Buffer } from 'buffer'
import process from 'process'

// the desktop code uses Buffer and process as globals, as Node provides them
Object.assign(globalThis, { Buffer, process, global: globalThis })
// workers and shared memory are not available in the WebView; plain buffers stand in so code that probes for them can fall back
if (typeof SharedArrayBuffer === 'undefined') Object.assign(globalThis, { SharedArrayBuffer: ArrayBuffer })
