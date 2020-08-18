const pdf = require("../pdfparser")
const fs = require("fs")

async function run() {
  const buffer = fs.readFileSync(__dirname + "/sample.pdf")
  const reader = new pdf()
  reader.PDFJS.options.pages = [1]
  reader.onFinish = (data) => {
    console.log("end")
  }
  reader.onError = (err) => {
    console.error("err", err)
  }
  reader.parseBuffer(buffer, { pages: [1] })
}
run()
