export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const accountSid         = process.env.TWILIO_ACCOUNT_SID;
  const authToken          = process.env.TWILIO_AUTH_TOKEN;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

  if (!accountSid || !authToken || !messagingServiceSid) {
    return res.status(500).json({
      error: "Missing Twilio environment variables. Make sure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_MESSAGING_SERVICE_SID are set in Vercel."
    });
  }

  const { messages } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "No messages provided." });
  }

  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  const results = { sent: 0, failed: 0, errors: [] };

  for (const { to, body } of messages) {
    try {
      const response = await fetch(twilioUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To:                   to,
          MessagingServiceSid:  messagingServiceSid,
          Body:                 body,
        }).toString(),
      });

      const data = await response.json();

      if (data.sid) {
        results.sent++;
      } else {
        results.failed++;
        results.errors.push({ to, error: data.message || "Unknown Twilio error" });
      }
    } catch (err) {
      results.failed++;
      results.errors.push({ to, error: err.message });
    }

    // 100ms delay between messages to respect Twilio rate limits
    await new Promise((r) => setTimeout(r, 100));
  }

  return res.status(200).json({ success: true, ...results });
}
