const functions = require("firebase-functions");

// SDK Config //

const localConfig = {
  openai: {
    id: "org-vNmy2oyRpfS2W6lDct9Gbmny", // Linkmate
    key: "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",
  },
  alpaca: {
    id: "timescale",
    key: "dde3336a4ba9c8c9bdd95755779aebf5",
  },
};

const { Configuration, OpenAIApi } = require("openai");
const configuration = new Configuration({
  organization: localConfig?.openai.id || functions.config().openai.id, // REPLACE with your API credentials
  apiKey: localConfig?.openai.key || functions.config().openai.key, // REPLACE with your API credentials
});
const openai = new OpenAIApi(configuration);

const Alpaca = require("@alpacahq/alpaca-trade-api");
const alpaca = new Alpaca({
  keyId: localConfig?.alpaca.id || functions.config().alpaca.id, // REPLACE with your API credentials
  secretKey: localConfig?.alpaca.key || functions.config().alpaca.key, // REPLACE with your API credentials
  // paper: true,
});

// PUPPETEER Scrape Data from Twitter for better AI context //

const puppeteer = require("puppeteer");

async function scrape() {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.69 Safari/537.36"
  );
  await page.goto("https://twitter.com/jimcramer", {
    waitUntil: "networkidle2",
  });
  await page.waitForTimeout(3000);

  // await page.screenshot({ path: 'example.png' });

  const tweets = await page.evaluate(async () => {
    return document.body.innerText;
  });

  await browser.close();

  console.log("Tweets", tweets);

  return tweets;
}

exports.helloWorld = functions.https.onRequest(async (request, response) => {
  // test logic here
  try {
    const gptCompletion = await openai.createCompletion("text-davinci-002", {
      prompt: `Jim Cramer recommends selling the following stock tickers: `,
      temperature: 0.7,
      max_tokens: 32,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
    });
    const tweets = await scrape();

    response.send({ openai: gptCompletion.data, tweets });
  } catch (error) {
    response.send(error).sendStatus(error.response.status);
    // response.send(error);
  }
});

exports.getRichQuick = functions
  .runWith({ memory: "4GB" })
  .pubsub.schedule("0 10 * * 1-5")
  .timeZone("Australia/Sydney")
  .onRun(async (ctx) => {
    console.log("This will run M-F at 10:00 AM AEST!");

    const tweets = await scrape();

    const gptCompletion = await openai.createCompletion("text-davinci-001", {
      prompt: `${tweets} Jim Cramer recommends selling the following stock tickers: `,
      temperature: 0.7,
      max_tokens: 32,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
    });

    const stocksToBuy = gptCompletion.data.choices[0].text.match(/\b[A-Z]+\b/g);
    console.log(`Thanks for the tips Jim! ${stocksToBuy}`);

    if (!stocksToBuy) {
      console.log("sitting this one out");
      return null;
    }

    //// ALPACA Make Trades ////

    // close all positions
    const cancel = await alpaca.cancelAllOrders();
    const liquidate = await alpaca.closeAllPositions();

    // get account
    const account = await alpaca.getAccount();
    console.log(`dry powder: ${account.buying_power}`);

    // place order
    const order = await alpaca.createOrder({
      symbol: stocksToBuy[0],
      // qty: 1,
      notional: account.buying_power * 0.9, // will buy fractional shares
      side: "buy",
      type: "market",
      time_in_force: "day",
    });

    console.log(`look mom i bought stonks: ${order.id}`);

    return null;
  });
