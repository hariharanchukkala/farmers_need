const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const axios = require('axios');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// --- Simple in-memory ads and content data ---
const ADS = [
  {
    id: 1,
    titleTe: 'ఉత్తమ నాణ్యమైన వరి విత్తనాలు',
    descriptionTe: 'ప్రమాణిత కంపెనీ నుండి అధిక దిగుబడి వరి విత్తనాలు.',
    imageUrl: 'https://example.com/images/rice-seeds.png',
    ctaTextTe: 'ఇంకా తెలుసుకోండి',
    ctaUrl: 'https://example.com/products/rice-seeds'
  },
  {
    id: 2,
    titleTe: 'డ్రిప్ ఇరిగేషన్ సెట్స్',
    descriptionTe: 'నీటి ఆదా, అధిక దిగుబడి కోసం డ్రిప్ సిస్టమ్.',
    imageUrl: 'https://example.com/images/drip-system.png',
    ctaTextTe: 'ఇప్పుడే సంప్రదించండి',
    ctaUrl: 'https://example.com/products/drip-irrigation'
  }
];

// Simple in-memory storage for ad/branding requests (for production use a DB)
const AD_REQUESTS = [];

// Simple in-memory discussion data (for production use a DB)
const DISCUSSION_POSTS = [];
const DISCUSSION_COMMENTS = [];

const CONTENT_ITEMS = [
  {
    id: 1,
    titleTe: 'ఒక ఎకరంలో వరి దిగుబడిని ఎలా పెంచాలి?',
    summaryTe:
      'సమయానికి నాట్లు నాటడం, సమయానికి ఎరువులు వేయడం, నీటి నిర్వహణను సవ్యంగా చేయడం ద్వారా వరి దిగుబడిని పెంచవచ్చు.',
    category: 'paddy',
    sourceLabelTe: 'ఆనాదాతా శైలి వ్యాసం (సంక్షిప్తం)',
    sourceUrl: 'https://example.com/articles/paddy-yield'
  },
  {
    id: 2,
    titleTe: 'తక్కువ నీటితో పెరుగు పంటలు',
    summaryTe:
      'శనగ, పెసర, మినుము వంటి పంటలు తక్కువ నీటితో కూడా మంచి దిగుబడి ఇస్తాయి.',
    category: 'pulses',
    sourceLabelTe: 'ఆనాదాతా శైలి వ్యాసం (సంక్షిప్తం)',
    sourceUrl: 'https://example.com/articles/low-water-crops'
  }
];

// --- Utility functions ---

async function fetchWeather(lat, lon) {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey || !lat || !lon) {
    return null;
  }

  try {
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
    const { data } = await axios.get(url);
    return data;
  } catch (err) {
    console.error('Error fetching weather:', err.message);
    return null;
  }
}

function summarizeWeather(forecast) {
  if (!forecast || !Array.isArray(forecast.list) || !forecast.list.length) {
    return null;
  }

  const first = forecast.list[0];
  const current = {
    time: first.dt_txt,
    temp: first.main?.temp,
    feelsLike: first.main?.feels_like,
    humidity: first.main?.humidity,
    windSpeed: first.wind?.speed,
    description: first.weather?.[0]?.description
  };

  // Pick one entry per day (every ~24h -> step 8 for 3‑hour data)
  const daily = [];
  for (let i = 0; i < forecast.list.length; i += 8) {
    const item = forecast.list[i];
    if (!item) continue;
    daily.push({
      time: item.dt_txt,
      temp: item.main?.temp,
      humidity: item.main?.humidity,
      description: item.weather?.[0]?.description
    });
  }

  return { current, daily };
}

async function reverseGeocode(lat, lon) {
  if (!lat || !lon) {
    return null;
  }

  try {
    // Using OpenStreetMap Nominatim (no key required, but respect usage limits in production)
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`;
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'telugu-farmer-assistant/1.0'
      }
    });

    const address = data.address || {};

    // Nominatim returns different keys, map to our fields
    const district =
      address.county ||
      address.state_district ||
      address.city_district ||
      address.city ||
      address.state ||
      null;
    const mandal = address.suburb || address.village || address.town || null;
    const village = address.village || address.hamlet || address.suburb || null;

    return {
      raw: data,
      district,
      mandal,
      village,
      displayName: data.display_name
    };
  } catch (err) {
    console.error('Error in reverseGeocode:', err.response?.data || err.message);
    return null;
  }
}

async function callLLMForTeluguExplanation(payload) {
  const url = process.env.LLM_API_URL;
  const apiKey = process.env.LLM_API_KEY;

  if (!url || !apiKey) {
    return null;
  }

  try {
    const { data } = await axios.post(
      url,
      {
        prompt:
          'Explain these crop recommendations and profit details in very simple Telugu language suitable for farmers. ' +
          'Use short sentences and bullet points. Input JSON: ' +
          JSON.stringify(payload),
        max_tokens: 512
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        }
      }
    );

    // Adjust this depending on your LLM provider's response format
    return data.choices?.[0]?.message?.content || data.text || null;
  } catch (err) {
    console.error('Error calling LLM:', err.response?.data || err.message);
    return null;
  }
}

function basicCropRules({ season, soilType, irrigationType }) {
  const crops = [];

  const s = (season || '').toLowerCase();
  const soil = (soilType || '').toLowerCase();
  const irr = (irrigationType || '').toLowerCase();

  if (s === 'kharif') {
    if (soil.includes('black')) {
      crops.push('cotton', 'red gram');
    } else {
      crops.push('paddy', 'maize');
    }
  } else if (s === 'rabi') {
    if (soil.includes('red')) {
      crops.push('groundnut', 'sunflower');
    } else {
      crops.push('wheat', 'chickpea');
    }
  } else {
    crops.push('vegetables', 'pulses');
  }

  if (irr.includes('rainfed')) {
    crops.push('millets');
  }

  // Remove duplicates
  return [...new Set(crops)];
}

function estimateEconomics(crop, landSizeAcres) {
  // Very rough sample numbers, replace with real data for production
  const base = {
    paddy: { yieldPerAcre: 25, pricePerQuintal: 2200, costPerAcre: 25000 },
    maize: { yieldPerAcre: 20, pricePerQuintal: 1800, costPerAcre: 20000 },
    cotton: { yieldPerAcre: 8, pricePerQuintal: 6500, costPerAcre: 30000 },
    'red gram': { yieldPerAcre: 7, pricePerQuintal: 7000, costPerAcre: 18000 },
    groundnut: { yieldPerAcre: 12, pricePerQuintal: 5500, costPerAcre: 22000 },
    sunflower: { yieldPerAcre: 8, pricePerQuintal: 5000, costPerAcre: 21000 },
    wheat: { yieldPerAcre: 20, pricePerQuintal: 2100, costPerAcre: 19000 },
    chickpea: { yieldPerAcre: 8, pricePerQuintal: 6000, costPerAcre: 17000 },
    millets: { yieldPerAcre: 10, pricePerQuintal: 2500, costPerAcre: 15000 },
    pulses: { yieldPerAcre: 8, pricePerQuintal: 5500, costPerAcre: 17000 },
    vegetables: { yieldPerAcre: 60, pricePerQuintal: 1500, costPerAcre: 40000 }
  };

  const key = crop.toLowerCase();
  const defaults = base[key] || { yieldPerAcre: 10, pricePerQuintal: 2000, costPerAcre: 20000 };

  const area = Number(landSizeAcres) || 1;
  const totalYieldQuintals = defaults.yieldPerAcre * area;
  const grossIncome = totalYieldQuintals * defaults.pricePerQuintal;
  const totalCost = defaults.costPerAcre * area;
  const netProfit = grossIncome - totalCost;

  return {
    crop,
    areaAcres: area,
    yieldPerAcre: defaults.yieldPerAcre,
    totalYieldQuintals,
    pricePerQuintal: defaults.pricePerQuintal,
    grossIncome,
    costPerAcre: defaults.costPerAcre,
    totalCost,
    netProfit
  };
}

// --- Routes ---

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', message: 'Telugu farmer API running' });
});

// Simple weather endpoint for UI
app.get('/api/weather', async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!lat || !lon) {
      return res.status(400).json({ error: 'lat and lon query params are required' });
    }

    const [forecast, reverseGeo] = await Promise.all([
      fetchWeather(lat, lon),
      reverseGeocode(lat, lon)
    ]);

    // If OpenWeather fetch failed (missing/invalid key or provider error), return a clear error
    if (!forecast) {
      return res.status(502).json({
        error: 'Weather provider unavailable',
        messageTe:
          'వాతావరణ డేటా తెచ్చుకోలేకపోయాం. OPENWEATHER_API_KEY సరి ఉందా (లేదా సెట్ చేశారా) చెక్ చేయండి.',
        hint:
          'Create .env and set OPENWEATHER_API_KEY, then restart the server. Also ensure internet access.'
      });
    }

    const summary = summarizeWeather(forecast);

    res.json({
      location: {
        lat,
        lon,
        district: reverseGeo?.district || null,
        mandal: reverseGeo?.mandal || null,
        village: reverseGeo?.village || null,
        displayName: reverseGeo?.displayName || null
      },
      summary,
      raw: forecast
    });
  } catch (err) {
    console.error('Error in /api/weather:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Crop recommendation + profit based on rules and basic economics, plus optional Telugu AI summary
app.post('/api/recommendations', async (req, res) => {
  try {
    const {
      district,
      mandal,
      village,
      lat,
      lon,
      landSizeAcres,
      soilType,
      irrigationType,
      season
    } = req.body || {};

    // If location names not provided but coordinates are, reverse geocode
    let resolvedDistrict = district;
    let resolvedMandal = mandal;
    let resolvedVillage = village;
    let reverseGeo = null;

    if ((!district || !mandal || !village) && lat && lon) {
      reverseGeo = await reverseGeocode(lat, lon);
      if (reverseGeo) {
        resolvedDistrict = resolvedDistrict || reverseGeo.district;
        resolvedMandal = resolvedMandal || reverseGeo.mandal;
        resolvedVillage = resolvedVillage || reverseGeo.village;
      }
    }

    const weather = await fetchWeather(lat, lon);
    const crops = basicCropRules({ season, soilType, irrigationType });
    const economics = crops.map((crop) => estimateEconomics(crop, landSizeAcres));

    const baseResponse = {
      location: {
        district: resolvedDistrict,
        mandal: resolvedMandal,
        village: resolvedVillage,
        lat,
        lon,
        reverseGeocode: reverseGeo
      },
      season,
      soilType,
      irrigationType,
      weather,
      recommendations: economics
    };

    // Try to get a Telugu explanation from LLM (if configured)
    const teluguExplanation = await callLLMForTeluguExplanation(baseResponse);

    res.json({
      ...baseResponse,
      teluguExplanation:
        teluguExplanation ||
        'క్రింది పంట సూచనలు మీ భూమి విస్తీర్ణం, నేల రకం, నీరు పరిస్థితి, సీజన్ ఆధారంగా లెక్కించబడ్డాయి.'
    });
  } catch (err) {
    console.error('Error in /api/recommendations:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reverse geocode endpoint for map / GPS selection
app.get('/api/location/reverse', async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!lat || !lon) {
      return res.status(400).json({ error: 'lat and lon query params required' });
    }
    const data = await reverseGeocode(lat, lon);
    if (!data) {
      return res.status(500).json({ error: 'Reverse geocoding failed' });
    }
    res.json(data);
  } catch (err) {
    console.error('Error in /api/location/reverse:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Profit calculator with editable inputs
app.post('/api/profit', (req, res) => {
  try {
    const {
      crop,
      landSizeAcres,
      yieldPerAcre,
      pricePerQuintal,
      costPerAcre
    } = req.body || {};

    const area = Number(landSizeAcres) || 1;
    const ypa = Number(yieldPerAcre) || 10;
    const ppq = Number(pricePerQuintal) || 2000;
    const cpa = Number(costPerAcre) || 20000;

    const totalYieldQuintals = ypa * area;
    const grossIncome = totalYieldQuintals * ppq;
    const totalCost = cpa * area;
    const netProfit = grossIncome - totalCost;

    res.json({
      crop,
      areaAcres: area,
      yieldPerAcre: ypa,
      totalYieldQuintals,
      pricePerQuintal: ppq,
      grossIncome,
      costPerAcre: cpa,
      totalCost,
      netProfit
    });
  } catch (err) {
    console.error('Error in /api/profit:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Drone booking integration (stub with external API hook)
app.post('/api/drone/book', async (req, res) => {
  try {
    const {
      farmerName,
      phone,
      district,
      mandal,
      village,
      lat,
      lon,
      landSizeAcres,
      crop,
      preferredDate
    } = req.body || {};

    const baseUrl = process.env.DRONE_API_BASE_URL;
    const apiKey = process.env.DRONE_API_KEY;

    // If no external API configured, just simulate a booking
    if (!baseUrl || !apiKey) {
      return res.json({
        mode: 'simulated',
        messageTe:
          'డ్రోన్ బుకింగ్ కోసం మీ అభ్యర్థన నమోదు అయింది. తక్షణమే కాల్ ద్వారా ధృవీకరిస్తాము.',
        booking: {
          id: `SIM-${Date.now()}`,
          farmerName,
          phone,
          district,
          mandal,
          village,
          lat,
          lon,
          landSizeAcres,
          crop,
          preferredDate,
          status: 'pending'
        }
      });
    }

    // Example pattern if AndhraTaxi provides REST API (you will need to adjust)
    const url = `${baseUrl}/drones/book`;

    const { data } = await axios.post(
      url,
      {
        farmerName,
        phone,
        district,
        mandal,
        village,
        lat,
        lon,
        landSizeAcres,
        crop,
        preferredDate
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': apiKey
        }
      }
    );

    res.json({
      mode: 'live',
      provider: 'AndhraTaxi',
      booking: data
    });
  } catch (err) {
    console.error('Error in /api/drone/book:', err.response?.data || err.message);
    res.status(500).json({ error: 'Drone booking failed' });
  }
});

// Ads endpoint
app.get('/api/ads', (_req, res) => {
  res.json({ ads: ADS });
});

// Discussion: list posts
app.get('/api/discussions', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const posts = [...DISCUSSION_POSTS]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit)
    .map((p) => ({
      ...p,
      commentCount: DISCUSSION_COMMENTS.filter((c) => c.postId === p.id).length
    }));
  res.json({ posts });
});

// Discussion: create post
app.post('/api/discussions', (req, res) => {
  const { name, phone, district, mandal, village, titleTe, problemTe } = req.body || {};
  if (!problemTe) {
    return res.status(400).json({ error: 'problemTe is required' });
  }

  const post = {
    id: `DP-${Date.now()}`,
    name: name || null,
    phone: phone || null,
    location: { district: district || null, mandal: mandal || null, village: village || null },
    titleTe: titleTe || null,
    problemTe,
    createdAt: new Date().toISOString()
  };

  DISCUSSION_POSTS.push(post);
  res.json({
    messageTe: 'మీ సమస్య పోస్ట్ అయింది. ఇతర రైతులు స్పందిస్తారు.',
    post
  });
});

// Discussion: list comments for a post
app.get('/api/discussions/:postId/comments', (req, res) => {
  const { postId } = req.params;
  const comments = DISCUSSION_COMMENTS.filter((c) => c.postId === postId).sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : 1
  );
  res.json({ comments });
});

// Discussion: add comment
app.post('/api/discussions/:postId/comments', (req, res) => {
  const { postId } = req.params;
  const { name, phone, replyTe } = req.body || {};
  if (!replyTe) {
    return res.status(400).json({ error: 'replyTe is required' });
  }

  const exists = DISCUSSION_POSTS.some((p) => p.id === postId);
  if (!exists) {
    return res.status(404).json({ error: 'Post not found' });
  }

  const comment = {
    id: `DC-${Date.now()}`,
    postId,
    name: name || null,
    phone: phone || null,
    replyTe,
    createdAt: new Date().toISOString()
  };

  DISCUSSION_COMMENTS.push(comment);
  res.json({
    messageTe: 'మీ సమాధానం నమోదు అయింది.',
    comment
  });
});

// Branding / advertising request endpoint
app.post('/api/ads/request', (req, res) => {
  const {
    brandName,
    contactName,
    phone,
    district,
    mandal,
    village,
    productTitleTe,
    descriptionTe,
    ctaUrl,
    budget,
    notes
  } = req.body || {};

  if (!brandName || !phone) {
    return res.status(400).json({ error: 'brandName and phone are required' });
  }

  const request = {
    id: `AR-${Date.now()}`,
    brandName,
    contactName: contactName || null,
    phone,
    targeting: { district: district || null, mandal: mandal || null, village: village || null },
    productTitleTe: productTitleTe || null,
    descriptionTe: descriptionTe || null,
    ctaUrl: ctaUrl || null,
    budget: budget || null,
    notes: notes || null,
    createdAt: new Date().toISOString(),
    status: 'received'
  };

  AD_REQUESTS.push(request);
  res.json({
    messageTe:
      'మీ బ్రాండింగ్ / ప్రకటన అభ్యర్థన నమోదు అయింది. త్వరలో మా టీమ్ మీకు కాల్ చేస్తుంది.',
    request
  });
});

// Aanadatha-style content endpoint
app.get('/api/content', (req, res) => {
  const { category } = req.query;
  const filtered = category
    ? CONTENT_ITEMS.filter((item) => item.category === String(category))
    : CONTENT_ITEMS;

  res.json({ items: filtered });
});

app.listen(PORT, () => {
  console.log(`Telugu farmer API listening on port ${PORT}`);
});

