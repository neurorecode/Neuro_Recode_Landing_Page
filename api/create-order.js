const DEFAULT_AMOUNT_PAISE = 299900;
const DEFAULT_CURRENCY = "INR";

function sendJson(res, statusCode, payload) {
  res.setHeader("Content-Type", "application/json");
  res.status(statusCode).json(payload);
}

function getAmountPaise() {
  const value = Number(process.env.CONSULTATION_AMOUNT_PAISE || DEFAULT_AMOUNT_PAISE);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_AMOUNT_PAISE;
}

function getCurrency() {
  return (process.env.CONSULTATION_CURRENCY || DEFAULT_CURRENCY).trim().toUpperCase();
}

function getLead(body) {
  const lead = body && typeof body === "object" ? body.lead || body : {};
  return {
    firstName: String(lead.firstName || "").trim(),
    lastName: String(lead.lastName || "").trim(),
    email: String(lead.email || "").trim(),
    phone: String(lead.phone || "").trim(),
    city: String(lead.city || "").trim(),
    goal: String(lead.goal || "").trim()
  };
}

function validateLead(lead) {
  const missing = [];
  if (!lead.firstName) missing.push("firstName");
  if (!lead.email) missing.push("email");
  if (!lead.phone) missing.push("phone");
  if (!lead.city) missing.push("city");
  if (!lead.goal) missing.push("goal");
  return missing;
}

async function createRazorpayOrder({ amount, currency, lead }) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error("RAZORPAY_ENV_MISSING");
  }

  const receipt = `nr_${Date.now()}`.slice(0, 40);
  const credentials = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      amount,
      currency,
      receipt,
      payment_capture: 1,
      notes: {
        firstName: lead.firstName.slice(0, 256),
        lastName: lead.lastName.slice(0, 256),
        email: lead.email.slice(0, 256),
        phone: lead.phone.slice(0, 256),
        city: lead.city.slice(0, 256)
      }
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data && data.error && data.error.description
      ? data.error.description
      : "Unable to create Razorpay order.";
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }

  return data;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { error: "Method not allowed." });
    return;
  }

  const lead = getLead(req.body);
  const missing = validateLead(lead);

  if (missing.length) {
    sendJson(res, 400, {
      error: "Please fill all required lead details.",
      missing
    });
    return;
  }

  const amount = getAmountPaise();
  const currency = getCurrency();

  try {
    const order = await createRazorpayOrder({ amount, currency, lead });

    sendJson(res, 200, {
      keyId: process.env.RAZORPAY_KEY_ID,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      businessName: "Neuro Recode",
      description: "Private Session Booking"
    });
  } catch (error) {
    if (error.message === "RAZORPAY_ENV_MISSING") {
      sendJson(res, 500, {
        error: "Razorpay environment variables are missing on the server."
      });
      return;
    }

    sendJson(res, error.statusCode || 500, {
      error: error.message || "Unable to create Razorpay order."
    });
  }
};
