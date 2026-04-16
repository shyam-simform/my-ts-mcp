const inputs = [
  "What is the weather in the rajkot?\n",
  "what is the weather in ahemdabad?",
  "What is the weather in \"Rajkot\"?",
  "weather in New York",
  "Ahmedabad",
];

function extractCity(city){
  let cityInput = String(city ?? "");
  cityInput = cityInput.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
  const low = cityInput.toLowerCase();
  const idxIn = low.lastIndexOf(" in ");
  const idxAt = low.lastIndexOf(" at ");
  if (idxIn !== -1 || idxAt !== -1) {
    const idx = Math.max(idxIn, idxAt);
    cityInput = cityInput.slice(idx + 4).trim();
  } else {
    cityInput = cityInput.replace(/^(?:what(?:'|\u2019)?s|what is|tell me the weather in|weather in)[:\s-]*/i, "").trim();
  }
  cityInput = cityInput.replace(/^the\s+/i, "").trim();
  cityInput = cityInput.replace(/^[\s'"`]+|[\s'"`?.!,:;]+$/g, "").trim();
  return cityInput;
}

for (const s of inputs) {
  console.log(JSON.stringify(s), '->', extractCity(s));
}
