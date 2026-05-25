const crypto = require("crypto");

function sendJson(res, statusCode, payload) {
  res.setHeader("Content-Type", "application/json");
  res.status(statusCode).json(payload);
}

function getLead(body) {
  const lead = body && typeof body === "object" ? body.lead || {} : {};
  return {
    firstName: String(lead.firstName || "").trim(),
    lastName: String(lead.lastName || "").trim(),
    email: String(lead.email || "").trim(),
    phone: String(lead.phone || "").trim(),
    city: String(lead.city || "").trim(),
    goal: String(lead.goal || "").trim()
  };
}

function getPayment(body) {
  const payment = body && typeof body === "object" ? body.payment || body : {};
  return {
    razorpay_order_id: String(payment.razorpay_order_id || "").trim(),
    razorpay_payment_id: String(payment.razorpay_payment_id || "").trim(),
    razorpay_signature: String(payment.razorpay_signature || "").trim()
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

function verifySignature(payment) {
  const secret = process.env.RAZORPAY_KEY_SECRET;

  if (!secret) {
    throw new Error("RAZORPAY_ENV_MISSING");
  }

  const payload = `${payment.razorpay_order_id}|${payment.razorpay_payment_id}`;
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  const expected = Buffer.from(expectedSignature);
  const received = Buffer.from(payment.razorpay_signature);

  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

async function sendToGoogleSheets({ lead, payment }) {
  const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL;

  if (!webhookUrl) {
    throw new Error("GOOGLE_WEBHOOK_ENV_MISSING");
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      submittedAt: new Date().toISOString(),
      paymentStatus: "paid",
      firstName: lead.firstName,
      lastName: lead.lastName,
      email: lead.email,
      phone: lead.phone,
      city: lead.city,
      goal: lead.goal,
      razorpayOrderId: payment.razorpay_order_id,
      razorpayPaymentId: payment.razorpay_payment_id
    })
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const error = new Error(text || "Unable to store lead in Google Sheets.");
    error.statusCode = response.status;
    throw error;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { error: "Method not allowed." });
    return;
  }

  const lead = getLead(req.body);
  const payment = getPayment(req.body);
  const missingLead = validateLead(lead);
  const missingPayment = [];

  if (!payment.razorpay_order_id) missingPayment.push("razorpay_order_id");
  if (!payment.razorpay_payment_id) missingPayment.push("razorpay_payment_id");
  if (!payment.razorpay_signature) missingPayment.push("razorpay_signature");

  if (missingLead.length || missingPayment.length) {
    sendJson(res, 400, {
      error: "Required lead or payment details are missing.",
      missing: {
        lead: missingLead,
        payment: missingPayment
      }
    });
    return;
  }

  try {
    if (!verifySignature(payment)) {
      sendJson(res, 400, { error: "Payment verification failed." });
      return;
    }

    await sendToGoogleSheets({ lead, payment });

    sendJson(res, 200, {
      success: true,
      redirectUrl: "/neuro-recode-thankyou.html"
    });
  } catch (error) {
    if (error.message === "RAZORPAY_ENV_MISSING") {
      sendJson(res, 500, {
        error: "Razorpay environment variables are missing on the server."
      });
      return;
    }

    if (error.message === "GOOGLE_WEBHOOK_ENV_MISSING") {
      sendJson(res, 500, {
        error: "Google Sheets webhook environment variable is missing on the server."
      });
      return;
    }

    sendJson(res, error.statusCode || 500, {
      error: error.message || "Unable to verify payment."
    });
  }
};
