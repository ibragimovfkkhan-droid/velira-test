const fs = require("fs");
const path = require("path");

function readJSON(fileName) {
  const filePath = path.join(__dirname, "..", "data", fileName);
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
}

function appendJSON(fileName, entry) {
  const filePath = path.join(__dirname, "..", "data", fileName);
  const list = readJSON(fileName);
  list.push(entry);
  fs.writeFileSync(filePath, JSON.stringify(list, null, 2), "utf-8");
  return list;
}

// Finds an entry by `id`, replaces it with `updater(entry)`, writes the file back.
// Returns the updated entry, or null if no entry with that id was found.
function updateJSONById(fileName, id, updater) {
  const filePath = path.join(__dirname, "..", "data", fileName);
  const list = readJSON(fileName);
  const idx = list.findIndex((item) => item.id === id);
  if (idx === -1) return null;
  list[idx] = updater(list[idx]);
  fs.writeFileSync(filePath, JSON.stringify(list, null, 2), "utf-8");
  return list[idx];
}

module.exports = { readJSON, appendJSON, updateJSONById };
