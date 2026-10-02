import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(root, "data/cards-source.csv");
const outputPath = resolve(root, "data/cards.json");
const expectedHeader = ["等级", "奖励宝石", "分数", "白", "蓝", "绿", "红", "黑", "总费用"];
const colors = ["white", "blue", "green", "red", "black"];
const bonusColors = new Map([
  ["黑(玛瑙)", "black"],
  ["蓝(蓝宝石)", "blue"],
  ["白(钻石)", "white"],
  ["绿(祖母绿)", "green"],
  ["红(红宝石)", "red"],
]);
const csv = await readFile(sourcePath, "utf8");
const [headerLine, ...dataLines] = csv.trim().split(/\r?\n/);
const header = headerLine.split(",");
if (header.length !== expectedHeader.length || header.some((column, index) => column !== expectedHeader[index])) {
  throw new Error("Unexpected CSV header; expected the documented Chinese card table columns.");
}

const cards = [];
for (const [index, line] of dataLines.entries()) {
  const fields = line.split(",").map((field) => field.trim());
  if (fields.length !== expectedHeader.length) {
    throw new Error(`Row ${index + 2} has ${fields.length} columns; expected ${expectedHeader.length}.`);
  }
  const [levelText, bonusName, pointsText, ...numericFields] = fields;
  const level = Number(levelText);
  const bonusColor = bonusColors.get(bonusName);
  const values = numericFields.map(Number);
  const [white, blue, green, red, black, totalCost] = values;
  const points = Number(pointsText);
  if (![1, 2, 3].includes(level) || !bonusColor || values.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error(`Invalid card data on CSV row ${index + 2}.`);
  }
  if (!Number.isInteger(points) || points < 0 || [white, blue, green, red, black].reduce((sum, value) => sum + value, 0) !== totalCost) {
    throw new Error(`Invalid score or total cost on CSV row ${index + 2}.`);
  }
  const sequence = cards.filter((card) => card.level === level).length + 1;
  cards.push({
    id: `L${level}-${String(sequence).padStart(2, "0")}`,
    level,
    bonusColor,
    points,
    cost: { white, blue, green, red, black },
  });
}

const distribution = Object.fromEntries(
  [1, 2, 3].map((level) => [level, cards.filter((card) => card.level === level).length]),
);
if (cards.length !== 90 || distribution[1] !== 40 || distribution[2] !== 30 || distribution[3] !== 20) {
  throw new Error(`Expected 90 cards distributed 40/30/20; received ${JSON.stringify(distribution)}.`);
}

const catalog = {
  kind: "user-provided-base-game-card-data",
  description: "Card values converted from the CSV table supplied by the project owner. No card artwork or card text is included.",
  distribution,
  cards,
};
await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Imported ${cards.length} cards (${distribution[1]}/${distribution[2]}/${distribution[3]}).`);
