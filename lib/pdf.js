// @ts-check
"use strict"

let nodeUtil = require("util"),
  nodeEvents = require("events"),
  fs = require("fs"),
  _ = require("lodash"),
  PDFField = require("./pdffield.js"),
  pkInfo = require("../package.json"),
  PDFFont = require("./pdffont"),
  baseloader = require("./baseloader"),
  PDFPageParser = require("./pageparser")

const _PARSER_SIG = `${pkInfo.name}@${pkInfo.version} [${pkInfo.homepage}]`

let PDFJS = baseloader.load()

////////////////////////////////Start of Node.js Module
let PDFJSClass = (function () {
  // private static
  let _nextId = 1
  let _name = "PDFJSClass"
  let _sufInfo = "_fieldInfo.xml"

  let _getMetaDataString = function (metadata, key) {
    let retVal = "unknown"
    if (metadata && metadata.has(key)) {
      retVal = encodeURIComponent(metadata.get(key))
    }
    return retVal
  }

  let _getMetaDataInt = function (metadata, key) {
    let retVal = _getMetaDataString(metadata, key)
    retVal = parseInt(retVal)
    if (retVal == null || isNaN(retVal)) retVal = -1
    return retVal
  }

  // constructor
  let cls = function (needRawText) {
    nodeEvents.EventEmitter.call(this)
    // private
    let _id = _nextId++

    // public (every instance will have their own copy of these methods, needs to be lightweight)
    this.get_id = () => _id
    this.get_name = () => _name + _id

    // public, this instance copies
    this.pdfDocument = null
    this.pages = []
    this.pageWidth = 0
    this.rawTextContents = []

    this.needRawText = needRawText
    this.pages = null
  }
  // inherit from event emitter
  nodeUtil.inherits(cls, nodeEvents.EventEmitter)

  cls.prototype.raiseErrorEvent = function (errMsg) {
    console.error(errMsg)
    process.nextTick(() => this.emit("pdfjs_parseDataError", errMsg))
    return errMsg
  }

  cls.prototype.raiseReadyEvent = function (data) {
    process.nextTick(() => this.emit("pdfjs_parseDataReady", data))
    return data
  }

  cls.prototype.parsePDFData = function (arrayBuffer, password) {
    this.pdfDocument = null

    let parameters = { password: password, data: arrayBuffer }
    PDFJS.getDocument(parameters).then(
      (pdfDocument) => this.load(pdfDocument, 1),
      (error) => this.raiseErrorEvent("An error occurred while parsing the PDF: " + error)
    )
  }

  cls.prototype.tryLoadFieldInfoXML = function (pdfFilePath) {
    let fieldInfoXMLPath = pdfFilePath.replace(".pdf", _sufInfo)
    if (fieldInfoXMLPath.indexOf(_sufInfo) < 1 || !fs.existsSync(fieldInfoXMLPath)) {
      return
    }
    nodeUtil.p2jinfo("About to load fieldInfo XML : " + fieldInfoXMLPath)

    let PTIXmlParser = require("./ptixmlinject")
    this.ptiParser = new PTIXmlParser()
    this.ptiParser.parseXml(fieldInfoXMLPath, (err) => {
      if (err) {
        nodeUtil.p2jwarn("fieldInfo XML Error: " + JSON.stringify(err))
        this.ptiParser = null
      } else {
        nodeUtil.p2jinfo("fieldInfo XML loaded.")
      }
    })
  }

  cls.prototype.load = function (pdfDocument, scale) {
    this.pdfDocument = pdfDocument

    return this.loadMetaData().then(
      () => this.loadPages(),
      (error) => this.raiseErrorEvent("loadMetaData error: " + error)
    )
  }

  cls.prototype.loadMetaData = function () {
    return this.pdfDocument.getMetadata().then(
      (data) => {
        this.documentInfo = data.info
        this.metadata = data.metadata
        this.parseMetaData()
      },
      (error) => this.raiseErrorEvent("pdfDocument.getMetadata error: " + error)
    )
  }

  cls.prototype.parseMetaData = function () {
    let info = this.documentInfo
    let metadata = this.metadata

    let pdfTile = ""
    if (metadata && metadata.has("dc:title")) {
      pdfTile = metadata.get("dc:title")
    } else if (info && info["Title"]) pdfTile = info["Title"]

    let formAttr = { AgencyId: "", Name: "", MC: false, Max: 1, Parent: "" }
    if (metadata) {
      formAttr.AgencyId = _getMetaDataString(metadata, "pdfx:agencyid")
      if (formAttr.AgencyId != "unknown") pdfTile = formAttr.AgencyId

      formAttr.Name = _getMetaDataString(metadata, "pdfx:name")
      formAttr.MC = _getMetaDataString(metadata, "pdfx:mc") === "true"
      formAttr.Max = _getMetaDataInt(metadata, "pdfx:max")
      formAttr.Parent = _getMetaDataInt(metadata, "pdfx:parent")
    }

    this.raiseReadyEvent({ Transcoder: _PARSER_SIG, Agency: pdfTile, Id: formAttr })
  }

  cls.prototype.loadPages = function () {
    let pagesCount = this.pdfDocument.numPages
    if (!cls.pages) {
      cls.pages = []
      for (let i = 1; i <= pagesCount; i++) {
        cls.pages.push(i)
      }
    }
    let pagePromises = cls.pages.map(this.pdfDocument.getPage(i))

    let pagesPromise = PDFJS.Promise.all(pagePromises)

    nodeUtil.p2jinfo("PDF loaded. pagesCount = " + pagesCount)

    return pagesPromise.then(
      (promisedPages) => this.parsePage(promisedPages, 0, 1.5),
      (error) => this.raiseErrorEvent("pagesPromise error: " + error)
    )
  }

  cls.prototype.parsePage = function (promisedPages, id, scale) {
    nodeUtil.p2jinfo("start to parse page:" + (id + 1))

    let pdfPage = promisedPages[id]
    let pageParser = new PDFPageParser(pdfPage, id, scale, this.ptiParser)

    function continueOnNextPage() {
      nodeUtil.p2jinfo("complete parsing page:" + (id + 1))
      if (id === this.pdfDocument.numPages - 1) {
        this.raiseReadyEvent({ Pages: this.pages, Width: this.pageWidth })

        //v1.1.2: signal end of parsed data with null
        process.nextTick(() => this.raiseReadyEvent(null))
      } else {
        process.nextTick(() => this.parsePage(promisedPages, ++id, scale))
      }
    }

    pageParser.parsePage(
      (data) => {
        if (!this.pageWidth)
          //get PDF width
          this.pageWidth = pageParser.width

        let page = {
          Height: pageParser.height,
          HLines: pageParser.HLines,
          VLines: pageParser.VLines,
          Fills: pageParser.Fills,
          //needs to keep current default output format, text content will output to a separate file if '-c' command line argument is set
          //                Content:pdfPage.getTextContent(),
          Texts: pageParser.Texts,
          Fields: pageParser.Fields,
          Boxsets: pageParser.Boxsets,
        }

        this.pages.push(page)

        if (this.needRawText) {
          pdfPage.getTextContent().then(
            (textContent) => {
              this.rawTextContents.push(textContent)
              nodeUtil.p2jinfo("complete parsing raw text content:" + (id + 1))
              continueOnNextPage.call(this)
            },
            (error) => this.raiseErrorEvent("pdfPage.getTextContent error: " + error)
          )
        } else {
          continueOnNextPage.call(this)
        }
      },
      (errMsg) => this.raiseErrorEvent("parsePage error:" + errMsg)
    )
  }

  cls.prototype.getRawTextContent = function () {
    let retVal = ""
    if (!this.needRawText) return retVal

    _.each(this.rawTextContents, function (textContent, index) {
      let prevText = null
      _.each(textContent.bidiTexts, function (textObj, idx) {
        if (prevText) {
          if (Math.abs(textObj.y - prevText.y) <= 9) {
            prevText.str += textObj.str
          } else {
            retVal += prevText.str + "\r\n"
            prevText = textObj
          }
        } else {
          prevText = textObj
        }
      })
      if (prevText) {
        retVal += prevText.str
      }
      retVal += "\r\n----------------Page (" + index + ") Break----------------\r\n"
    })

    return retVal
  }

  cls.prototype.getAllFieldsTypes = function () {
    return PDFField.getAllFieldsTypes({ Pages: this.pages || [], Width: this.pageWidth })
  }

  cls.prototype.getMergedTextBlocksIfNeeded = function () {
    for (let p = 0; p < this.pages.length; p++) {
      let prevText = null
      let page = this.pages[p]

      page.Texts.sort(PDFFont.compareBlockPos)
      page.Texts = page.Texts.filter((t, j) => {
        let isDup = j > 0 && PDFFont.areDuplicateBlocks(page.Texts[j - 1], t)
        if (isDup) {
          nodeUtil.p2jinfo("skipped: dup text block: " + decodeURIComponent(t.R[0].T))
        }
        return !isDup
      })

      for (let i = 0; i < page.Texts.length; i++) {
        let text = page.Texts[i]

        if (prevText) {
          if (PDFFont.areAdjacentBlocks(prevText, text) && PDFFont.haveSameStyle(prevText, text)) {
            let preT = decodeURIComponent(prevText.R[0].T)
            let curT = decodeURIComponent(text.R[0].T)

            prevText.R[0].T += text.R[0].T
            prevText.w += text.w
            text.merged = true

            let mergedText = decodeURIComponent(prevText.R[0].T)
            nodeUtil.p2jinfo(`merged text block: ${preT} + ${curT} => ${mergedText}`)
            prevText = null //yeah, only merge two blocks for now
          } else {
            prevText = text
          }
        } else {
          prevText = text
        }
      }

      page.Texts = page.Texts.filter((t) => !t.merged)
    }

    return { Pages: this.pages, Width: this.pageWidth }
  }

  cls.prototype.destroy = function () {
    this.removeAllListeners()

    if (this.pdfDocument) this.pdfDocument.destroy()
    this.pdfDocument = null

    this.pages = null
    this.rawTextContents = null
  }

  return cls
})()

module.exports = {
  PDFJS,
  PDFJSClass,
  PDFPageParser,
}
