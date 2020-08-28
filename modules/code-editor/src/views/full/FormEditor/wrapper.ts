const START_COMMENT = `/** Your code starts below */`
const END_COMMENT = '/** Your code ends here */'

const ACTION_HTTP_SIGNATURE = 'function action(event: sdk.IO.IncomingEvent)'

export const addWrapper = (content, args) => {
  return `${ACTION_HTTP_SIGNATURE} {\n  ${args} \n  ${START_COMMENT}\n\n${content}\n\n  ${END_COMMENT}\n}`
}

export const removeWrapper = content => {
  const startIndex = content.indexOf(START_COMMENT)
  const endIndex = content.indexOf(END_COMMENT)

  if (startIndex === -1 || endIndex === -1) {
    return content
  }

  const emptyLineAtBeginning = /^\s+?\n/
  const emptyLineAtEnd = /\s+?\n?$/
  return content
    .substring(startIndex + START_COMMENT.length, endIndex)
    .replace(emptyLineAtBeginning, '')
    .replace(emptyLineAtBeginning, '')
    .replace(emptyLineAtEnd, '')
}
