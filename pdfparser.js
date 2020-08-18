// @ts-check
const base = require("./lib/pdf")

class PDFParser {
  constructor(needRawText) {
    this.PDFJS = new base.PDFJSClass(needRawText)
    this.chunks = []
    this.flushCallback = null
  }

  onFinish(output) {}

  onError(err) {}

  parseBuffer(buffer) {
    this.data = {}
    this.PDFJS.on("pdfjs_parseDataReady", (data) => {
      if (!data) {
        //v1.1.2: data===null means end of parsed data
        let output = { formImage: this.data }
        this.onFinish(output)
      } else {
        Object.assign(this.data, data)
      }
    })
    this.PDFJS.on("pdfjs_parseDataError", (data) => {
      this.data = null
      this.onError({ parserError: data })
    })
    this.PDFJS.parsePDFData(buffer)
  }

  destroy() {
    this.data = null
    this.chunks = null
    this.PDFJS.destroy()
    this.PDFJS = null
  }
}

module.exports = PDFParser
