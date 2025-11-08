const fs = require('fs');
const path = require('path');

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function parseGuideMarkdown(markdownText) {
  const lines = markdownText.split(/\r?\n/);
  const sections = [];

  let current = null;
  let buffer = [];

  const flush = () => {
    if (current) {
      current.body = buffer.join('\n');
      sections.push(current);
    }
    current = null;
    buffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headerMatch = /^##\s+(.+?)\s*$/.exec(line);
    if (headerMatch) {
      flush();
      current = { name: headerMatch[1].trim(), body: '' };
      continue;
    }
    if (current) buffer.push(line);
  }
  flush();

  const map = new Map();

  for (const sec of sections) {
    const body = sec.body.trim();
    const obj = { name: sec.name };

    // Description first paragraph after **Description:** prefix
    const descMatch = /\*\*Description:\*\*\s*([^\n]+)(?:\n|$)/.exec(body);
    if (descMatch) {
      obj.description_main = descMatch[1].trim();
    }

    // Yelp highlights paragraph starts with "Yelp categorizes"
    const yelpParaMatch = /(^|\n)\s*(Yelp categorizes[\s\S]*?)(?=\n\n|\n\*\*|$)/.exec(body);
    if (yelpParaMatch) {
      obj.yelp_review_highlights = yelpParaMatch[2].trim();
    }

    // Reddit paragraph starts with "Redditors"
    const redditParaMatch = /(^|\n)\s*(Redditors[\s\S]*?)(?=\n\n|\n\*\*|$)/.exec(body);
    if (redditParaMatch) {
      obj.reddit = redditParaMatch[2].trim();
    }

    // Fields
    const priceMatch = /\*\*Price:\*\*\s*([^\n]+)/.exec(body);
    if (priceMatch) obj.price = priceMatch[1].trim();

    const availableMatch = /\*\*Available:\*\*\s*([^\n]+)/.exec(body);
    if (availableMatch) obj.available = availableMatch[1].trim();

    const yelpRatingMatch = /\*\*Yelp Rating:\*\*\s*([0-9]+(?:\.[0-9]+)?)/.exec(body);
    if (yelpRatingMatch) obj.yelp_rating = parseFloat(yelpRatingMatch[1]);

    const yelpCountMatch = /\*\*Yelp Review Count:\*\*\s*([0-9]+)/.exec(body);
    if (yelpCountMatch) obj.yelp_review_count = parseInt(yelpCountMatch[1], 10);

    const yelpUrlMatch = /\*\*Yelp:\*\*\s*\[([^\]]+)\]\([^\)]+\)/.exec(body);
    if (yelpUrlMatch) obj.yelp_url = yelpUrlMatch[1].trim();

    map.set(sec.name, obj);
  }

  return map;
}

function main() {
  const root = process.cwd();
  const finalDataPath = path.join(root, 'src', 'data', 'FinalData.json');
  const guidePath = path.join(root, 'src', 'data', 'restaurant_guide.md');
  const outputPath = path.join(root, 'src', 'data', 'FinalData_v2.json');

  const finalData = JSON.parse(readFile(finalDataPath));
  const guideText = readFile(guidePath);
  const guideMap = parseGuideMarkdown(guideText);

  const output = finalData.map((item) => {
    const name = String(item.name || '').trim();
    const guide = guideMap.get(name);
    if (!guide) return { ...item };

    const merged = { ...item };

    // price, available, yelp fields
    if (guide.price && ['$', '$$', '$$$', '$$$$'].includes(guide.price)) {
      merged.price = guide.price;
    } else if (guide.price === '' || guide.price === 'N/A') {
      merged.price = '';
    }

    if (guide.available && guide.available !== 'N/A') {
      merged.available = guide.available;
    }

    if (typeof guide.yelp_rating === 'number') {
      merged.yelp_rating = guide.yelp_rating;
    }
    if (typeof guide.yelp_review_count === 'number') {
      merged.yelp_review_count = guide.yelp_review_count;
    }
    if (guide.yelp_url) {
      merged.yelp_url = guide.yelp_url;
    }

    // split description: update summary to first paragraph
    if (guide.description_main) {
      merged.summary = guide.description_main;
    }

    // add highlights if present (omit if missing)
    if (guide.yelp_review_highlights) {
      merged.yelp_review_highlights = guide.yelp_review_highlights;
    }
    if (guide.reddit) {
      merged.reddit = guide.reddit;
    }

    return merged;
  });

  writeFile(outputPath, JSON.stringify(output, null, 2));
  // eslint-disable-next-line no-console
  console.log(`Wrote ${output.length} records to ${outputPath}`);
}

main();


