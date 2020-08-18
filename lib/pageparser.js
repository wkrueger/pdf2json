// @ts-check
let nodeEvents = require("events")
let PDFField = require("./pdffield.js")
let PDFUnit = require("./pdfunit.js")
let nodeUtil = require("util")
let PDFCanvas = require("./pdfcanvas.js")
let _ = require("lodash")

//////replacing HTML5 canvas with PDFCanvas (in-memory canvas)
function createScratchCanvas(width, height) {
  return new PDFCanvas({}, width, height)
}

////////////////////////////////start of helper classes
let PDFPageParser = (function () {
  // private static
  let _nextId = 1
  let _name = "PDFPageParser"

  let RenderingStates = {
    INITIAL: 0,
    RUNNING: 1,
    PAUSED: 2,
    FINISHED: 3,
  }

  let _addField = function (field) {
    if (!PDFField.isFormElement(field)) return

    let oneField = new PDFField(field, this.viewport, this.Fields, this.Boxsets)
    oneField.processField()
  }

  // constructor
  let cls = function (pdfPage, id, scale, ptiParser) {
    nodeEvents.EventEmitter.call(this)
    // private
    let _id = _nextId++

    // public (every instance will have their own copy of these methods, needs to be lightweight)
    this.get_id = () => _id
    this.get_name = () => _name + _id

    // public, this instance copies
    this.id = id
    this.pdfPage = pdfPage
    this.ptiParser = ptiParser

    this.scale = scale || 1.0

    //leave out the 2nd parameter in order to use page's default rotation (for both portrait and landscape form)
    this.viewport = this.pdfPage.getViewport(this.scale)

    this.renderingState = RenderingStates.INITIAL

    //form elements other than radio buttons and check boxes
    this.Fields = []
    //form elements: radio buttons and check boxes
    this.Boxsets = []

    //public properties
    Object.defineProperty(this, "width", {
      get: function () {
        return PDFUnit.toFormX(this.viewport.width)
      },
      enumerable: true,
    })

    Object.defineProperty(this, "height", {
      get: function () {
        return PDFUnit.toFormY(this.viewport.height)
      },
      enumerable: true,
    })
  }
  // inherit from event emitter
  nodeUtil.inherits(cls, nodeEvents.EventEmitter)

  cls.prototype.destroy = function () {
    this.pdfPage.destroy()
    this.pdfPage = null

    this.ptiParser = null
    this.Fields = null
    this.Boxsets = null
  }

  cls.prototype.getPagePoint = function (x, y) {
    return this.viewport.convertToPdfPoint(x, y)
  }

  cls.prototype.parsePage = function (callback, errorCallBack) {
    if (this.renderingState !== RenderingStates.INITIAL)
      return errorCallBack("Must be in new state before drawing")

    this.renderingState = RenderingStates.RUNNING

    let canvas = createScratchCanvas(1, 1)
    let ctx = canvas.getContext("2d")

    function pageViewDrawCallback(error) {
      this.renderingState = RenderingStates.FINISHED

      if (error) {
        let errMsg =
          "An error occurred while rendering the page " +
          (this.id + 1) +
          ":\n" +
          error.message +
          ":\n" +
          error.stack
        errorCallBack(errMsg)
      } else {
        if (this.ptiParser) {
          let extraFields = this.ptiParser.getFields(parseInt(this.id) + 1)
          _.each(extraFields, _.bind(_addField, this))
        }

        _.extend(this, ctx.canvas)
        this.stats = this.pdfPage.stats

        nodeUtil.p2jinfo("page " + (this.id + 1) + " is rendered successfully.")
        callback()
      }
    }

    let renderContext = {
      canvasContext: ctx,
      viewport: this.viewport,
    }

    this.pdfPage.render(renderContext).then(
      (data) => {
        this.pdfPage.getAnnotations().then(
          (fields) => {
            _.each(fields, _.bind(_addField, this))
            pageViewDrawCallback.call(this, null)
          },
          (err) => console.error("pdfPage.getAnnotations error:" + err)
        )
      },
      (err) => pageViewDrawCallback.call(this, err)
    )
  }

  return cls
})()

module.exports = PDFPageParser
