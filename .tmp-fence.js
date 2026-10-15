function isClosingFence(line, marker, len) {
  const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
  return Boolean(m && m[1][0] === marker && m[1].length >= len);
}
module.exports = isClosingFence;