const express = require("express");
const axios = require("axios");
const app = express();
const qs = require("qs");
const hsHelpers = require("./hshelpers.js");
require("dotenv").config();

let currentAccessToken = null;
let refreshToken = null;
let refreshTimeout = null;
let tokenExpiryTime = null;

const BASE_URI = process.env.BASE_URI;
const FormData = require("form-data");
const path = require("path");
const fs = require("fs");

const DESTINATION_ACCESS_TOKEN = process.env.DESTINATION_ACCESS_TOKEN;
const CONTACT_ERROR_LOG_FILE = path.join(__dirname, "contact-sync-errors.json");
const EMAILS_LOG_FILE = path.join(__dirname, "zoho-emails.json");
const NOTES_LOG_FILE = "zoho_contact_notes_log.json";
const TICKET_LOG_FILE = "zoho_ticket_log.json";

const HUBSPOT_ACCESS_TOKEN = process.env.DESTINATION_ACCESS_TOKEN;
function normalizeLabel(label) {
  return label
    .toLowerCase()
    .replace(/\s+/g, "_") // spaces → underscores
    .replace(/[^\w]/g, ""); // remove special characters (optional)
}
// 🎯 Hardcoded fallback mappings for unmatched normalized labels
const hardcodedFieldOverrides = {
  company: "company",
  title: "title",
  phone: "phone",
  website: "website",
  employees: "employees",
  no_of_employee: "no_of_employee",
  state: "state",
  notes_: "notes",
  organization_type: "industry",
  currentCompanyUrl: "currentcompanyurl",
  ads_platform: "ad_source",
  phone__company_hq: "phone_2",
  first_visit: "first_visited_time",
  most_recent_visit: "last_visited_time",
  first_page_visited: "first_visited_url",
  linkedin_connection: "linkedin_connected",
  suffix: "salutation",
  bdr_owner: "zoho_bdr_id",
  lead_owner: "lead_owner",
  email: "email",
  account_name: "account_name",
  fax: "fax",
  // lead_contact_status:"lead_contact_status"
};
async function getZohoAccessToken() {
  const url = "https://accounts.zoho.com/oauth/v2/token"; // use zoho.in if you're in India
  const data = qs.stringify({
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    //  redirect_uri: process.env.ZOHO_REDIRECT_URL,
    code: process.env.Code, // <-- Fix this env var casing
    grant_type: "authorization_code",
  });
  // console.log("data", data);

  try {
    const response = await axios.post(url, data, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
    console.log("response", response.data);
    const { access_token, refresh_token, expires_in } = response.data;

    console.log("✅ Zoho access token retrieved successfully");
    console.log("access_token:", access_token);
    console.log("refresh_token:", refresh_token);

    // 🟢 Update global values
    currentAccessToken = access_token;
    refreshToken = refresh_token;
    tokenExpiryTime = Date.now() + (expires_in - 60) * 1000;

    return { access_token, refresh_token, expires_in };
  } catch (error) {
    console.error(
      "❌ Error fetching Zoho access token:",
      error.response?.data || error.message
    );
    throw new Error("Failed to get Zoho access token");
  }
}
async function refreshAccessToken() {
  const url = "https://accounts.zoho.com/oauth/v2/token"; // make sure this matches with the token creation domain
  if (!refreshToken) {
    throw new Error("❌ Missing refresh token. Cannot refresh access token.");
  }

  const data = qs.stringify({
    grant_type: "refresh_token",
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    refresh_token: refreshToken,
  });

  try {
    const response = await axios.post(url, data, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const { access_token, expires_in } = response.data;

    // 🟢 Save updated access token globally
    currentAccessToken = access_token;
    tokenExpiryTime = Date.now() + (expires_in - 60) * 1000;

    console.log(
      "✅ Refreshed Zoho access_token. Expires in:",
      expires_in,
      "seconds"
    );

    if (refreshTimeout) clearTimeout(refreshTimeout);
    refreshTimeout = setTimeout(refreshAccessToken, (expires_in - 60) * 1000);

    return access_token;
  } catch (error) {
    console.error(
      "❌ Error auto-refreshing access token:",
      error.response?.data || error.message
    );
    throw new Error("Access token refresh failed."); // Do not return null
  }
}

// 1. Fetch Zoho field map
async function fetchZohoFieldMap(access_token, objectName) {
  const url = `https://www.zohoapis.com/crm/v3/settings/fields?module=${objectName}`;
  const map = {};
  const res = await axios.get(url, {
    headers: {
      Authorization: `Zoho-oauthtoken ${access_token}`,
    },
  });
  const fieldCount = res.data.fields.length;
  console.log(`📦 Total fields in Zoho ${objectName} module: ${fieldCount}`);

  res.data.fields.forEach((f) => {
    const normalized = normalizeLabel(f.field_label);
    map[normalized] = f.api_name;
  });
  // console.log("🔗 Zoho Field Map:", map);

  return map;
}

// 2. Fetch HubSpot field map
async function fetchHubSpotFieldMap(objecttype) {
  const url = `https://api.hubapi.com/crm/v3/properties/${objecttype}`;
  const map = {};
  const res = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
    },
  });

  res.data.results.forEach((f) => {
    const normalized = normalizeLabel(f.label);

    // ❌ Skip hs_lead_status to avoid accidental mapping
    if (f.name === "hs_lead_status") {
      console.log(`🚫 Skipping default HubSpot property: hs_lead_status`);
      return;
    }
    if (f.name === "Created_Time") {
      console.log(`🚫 Skipping default HubSpot property: Created_Time`);
      return;
    }
    if (f.name === "Modified_Time") {
      console.log(`🚫 Skipping default HubSpot property: Modified_Time`);
      return;
    }

    map[normalized] = f.name;
  });
  // console.log("🔗 Hubspot Field Map:", map);

  return map;
}

// 3. Build dynamic map: Zoho API name ➜ HubSpot API name
async function buildFieldMap(access_token) {
  const zohoFields = await fetchZohoFieldMap(access_token, "Contacts"); // { normalized_label: zohoApiName }
  const hubspotFields = await fetchHubSpotFieldMap("contacts"); // { normalized_label: hubspotApiName }

  const dynamicMap = {};
  const unmatchedFields = [];

  for (const [normalizedLabel, zohoApiName] of Object.entries(zohoFields)) {
    if (hubspotFields[normalizedLabel]) {
      dynamicMap[zohoApiName] = hubspotFields[normalizedLabel];
      console.log(
        `✅ Mapping ${zohoApiName} ➜ ${hubspotFields[normalizedLabel]}`
      );
    } else if (hardcodedFieldOverrides[normalizedLabel]) {
      dynamicMap[zohoApiName] = hardcodedFieldOverrides[normalizedLabel];
      console.log(
        `🔁 Hardcoded Mapping ${zohoApiName} ➜ ${hardcodedFieldOverrides[normalizedLabel]}`
      );
    } else {
      unmatchedFields.push({ label: normalizedLabel, apiName: zohoApiName });
    }
  }

  if (unmatchedFields.length > 0) {
    console.log("\n⚠️ Unmatched Zoho Fields (not found in HubSpot):");
    unmatchedFields.forEach((field) => {
      console.log(`❌ ${field.apiName} (label: ${field.label})`);
    });
  }

  return dynamicMap;
}

app.get("/zoho/contacts", async (req, res) => {
  let tokenObj = await getZohoAccessToken();
  let access_token = tokenObj.access_token;
  // let access_token =
  //   "1000.73796ee29f61232b34cff4c7c104677c.125ee33e2ceb8ad6744fa2eee6521d70";
  // const objectType = "Contact";

  let page = 1;
  let moreRecords = true;

  try {
    const fieldMap = await buildFieldMap(access_token);
    console.log("🔗 Final Mapping:", fieldMap);

    while (moreRecords) {
    console.log(`📄 Fetching page: ${page}`);

    // const url = `https://www.zohoapis.com/crm/v2/Leads?per_page=5&page=${page}`;
    // const url = "https://www.zohoapis.com/crm/v2/Contacts/4582160000102983007";
    // const url = "https://www.zohoapis.com/crm/v2/Contacts/4582160000022551008";

    const url = "https://www.zohoapis.com/crm/v2/Contacts/4582160000172214016";

    const contactRes = await axios.get(url, {
      headers: {
        Authorization: `Zoho-oauthtoken ${access_token}`,
      },
    });

    const zohoContacts = contactRes.data.data || [];
    console.log("zohoContacts", zohoContacts);
    // console.log(`📦 Fetched ${zohoContacts.length} Zoho contacts on page ${page}`);

    if (zohoContacts.length === 0) {
      moreRecords = false;
      break;
    }

    await syncContactsToHubSpot(zohoContacts, fieldMap, objectType);

    moreRecords = contactRes.data.info?.more_records || false;
    page += 1;
    }

    res.status(200).json({ message: "✅ Zoho contacts synced to HubSpot." });
  } catch (error) {
    const errData = error.response?.data;

    if (errData?.code === "INVALID_TOKEN") {
      console.warn("⚠️ Access token invalid. Refreshing...");
      access_token = await refreshAccessToken(); // You must implement this if not already
      return res
        .status(401)
        .json({ message: "Token refreshed. Please retry." });
    }

    if (
      errData?.code === "RATE_LIMIT_EXCEEDED" ||
      errData?.message?.toLowerCase().includes("rate limit") ||
      errData?.code === "TOO_MANY_REQUESTS"
    ) {
      console.error(`⏳ Rate limit hit. Stopping sync.`);
      return res
        .status(429)
        .json({ error: "Rate limit hit. Try again later." });
    }

    console.error("❌ Unhandled error during sync:", errData || error.message);
    res.status(500).json({
      error: "Failed to sync contacts.",
      details: errData || error.message,
    });
  }
});
async function syncContactsToHubSpot(zohoContacts, fieldMap, objectType) {
  const emailStatusMap = {
    "-None-": "NONE",
    "Request is in progress": "Request is in progress",
    Real: "Existing",
    Fake: "Nonexistent",
    Unknown: "Unknown",
    "Out of limit": "Out of limit",
    "Safe to send": "Safe to send",
  };
  const leadStatusMap = {
    "-None-": "NONE",
    Qualified: "QUALIFIED",
    "Is Not Qualified": "IS_NOT_QUALIFIED",
    "SQL Qualified": "SQL_QUALIFIED",
    "Not Qualified": "NOT_QUALIFIED",
    Unknown: "UNKNOWN",
    Prospect: "PROSPECT",
    "Do Not Call": "DO_NOT_CALL",
    "Do Not Contact": "DO_NOT_CONTACT",
    Customer: "CUSTOMER",
    "Pre-Qualified": "PRE_QUALIFIED",
    Contacted: "CONTACTED",
    "Contact in Future": "CONTACT_IN_FUTURE",
    "Not Contacted": "NOT_CONTACTED",
    "Attempted to Contact": "ATTEMPTED_TO_CONTACT",
    "Lost Lead": "LOST_LEAD",
    "Meeting - Pending": "MEETING_PENDING",
    Nurture: "NURTURE",
    "Meeting - Booked": "MEETING_BOOKED",
    "Channel Partner": "CHANNEL_PARTNER",
    Imported: "IMPORTED",
    "PPC - New": "PPC_NEW",
    Warm: "WARM",
    "Call me": "CALL_ME",
    Inactive: "INACTIVE",
    "Email 4": "EMAIL_4",
    Called: "CALLED",
    "No Phone Number": "NO_PHONE_NUMBER",
    "Left Voicemail": "LEFT_VOICEMAIL",
    "New Lead": "NEW",
    Open: "OPEN",
    "In Progress": "IN_PROGRESS",
    "Open Deal": "OPEN_DEAL",
    Unqualified: "UNQUALIFIED",
    Connected: "CONNECTED",
    "Bad Timing": "BAD_TIMING",
  };
  const leadTypeMap = {
    critical: "Critical",
    hot: "Hot",
    warm: "Warm",
    cold: "Cold",
    "-none-": "-None-",
  };
  const icpMap = {
    Yes: "Yes",
    No: "No",
    "Cant Confirm": "Can't Confirm",
    "-None-": "-None-",
  };
  const leadSourceMap = {
    "-none-": "-None-",
    growth: "Growth",
    organic: "Organic",
    outbound: "Outbound",
    "inside sales": "Inside Sales",
    ppc: "PPC",
    relationship: "Relationship",
    "demo account": "Demo Account",
    "app free trial": "APP_FREE_TRIAL",
    awareness: "AWARENESS",
    casestudydoctustechhelpsboostrafaccuracy: "CASESTUDY",
    "changes between hcc v24 and hcc v28": "VERSION_CHANGES",
    "cold call": "COLD_CALL",
    "cold linkedin outreach": "LINKEDIN_OUTREACH",
    "compliance sme interview": "COMPLIANCE_INTERVIEW",
    "demo account user": "DEMO_USER",
    discovery: "DISCOVERY",
    "ebook measuring the value of value-based care": "EBOOK_VALUE_CARE",
    email: "EMAIL", // 👈 this one matches now
    "existing customer": "EXISTING_CUSTOMER",
    "facebook ads": "FACEBOOK_ADS",
    "hcc audits compliance": "HCC_COMPLIANCE",
    "hcc quick guide": "HCC_GUIDE",
    "integrated platform contact": "INTEGRATED_CONTACT",
    "lead gen form": "LEAD_GEN_FORM",
    "learn about app": "LEARN_ABOUT_APP",
    "learn more - performance max campaign": "PERFORMANCE_MAX",
    "learn with app": "LEARN_APP",
    "learn with doctus": "LEARN_DOCTUS",
    "learn with doctustech": "LEARN_DOCTUSTECH",
    "learn with mobile app": "LEARN_MOBILE_APP",
    "linkedin ads": "LINKEDIN_ADS",
    "linkedin form": "LINKEDIN_FORM",
    "linkedin sales search": "LINKEDIN_SALES_SEARCH",
    "ob aco": "OB_ACO",
    "ob athena": "OB_ATHENA",
    "ob persona": "OB_PERSONA",
    "ob re-engaged": "OB_RE-ENGAGED",
    "personal network": "PERSONAL_NETWORK",
    "radv whitepaper": "RADV_WHITEPAPER",
    "raf revenue calculator": "RAF_REVENUE_CALCULATOR",
    referral: "REFERRAL",
    "risk adjustment one pager": "RISK_ADJUSTMENT_ONE_PAGER",
    "roi calculator": "ROI_Calculator",
    schedule_a_demo: "SCHEDULE1_A_DEMO",
    scupdap: "SCUPDAP",
    seamless: "SEAMLESS",
    "site contact us": "SITE_CONTACT_US",
    tradeshow: "TRADESHOW",
    "visitor insites": "VISITOR_INSITES",
    webinar: "WEBINAR",
    zoominfo: "ZOOMINFO",
    warm: "WARM",
  };
  const leadSourceTypeMap = {
    "-none-": "-None-",
    "demo account": "Demo Account",
    expansion: "Expansion",
    growth: "Growth",
    "inside sales": "Inside Sales",
    organic: "Organic",
    ppc: "PPC",
    relationship: "Relationship",
  };

  const errorLogs = [];

  for (const contact of zohoContacts) {
    try {
      if (!contact.Email) continue;
      const existingId = await hsHelpers.searchContactInHubSpot(contact.Email);
      // console.log("🔍 Existing HubSpot Contact ID:", existingId);
      const properties = {};
      for (const [zohoKey, hubspotKeyOriginal] of Object.entries(fieldMap)) {
        if (hubspotKeyOriginal === "lead_stage") {
          console.log(`⏭️ Skipping lead_stage for ${contact.Email}`);
          continue;
        }
        let hubspotKey = hubspotKeyOriginal;
        let value;

        if (zohoKey === "BDR_Owner") {
          value = contact.BDR_Owner?.name || null;
        } else {
          value = contact[zohoKey];
        }

        if (
          (value !== null &&
            value !== undefined &&
            (typeof value === "string" ||
              typeof value === "number" ||
              typeof value === "boolean")) ||
          Array.isArray(value)
        ) {
          // 🛠 Mapping rules
          if (hubspotKey === "zohocheckeremail__email_status") {
            if (emailStatusMap[value]) {
              properties[hubspotKey] = emailStatusMap[value];
            } else {
              console.warn(
                `⚠️ Skipping invalid email status value "${value}" for ${contact.Email}`
              );
            }
          } else if (
            hubspotKey === "zohocheckeremail__secondary_email_status"
          ) {
            if (emailStatusMap[value]) {
              properties[hubspotKey] = emailStatusMap[value];
            } else {
              console.warn(
                `⚠️ Skipping invalid email status value "${value}" for ${contact.Email}`
              );
            }
          } else if (hubspotKey === "lead_type") {
            const mappedType = leadTypeMap[String(value).toLowerCase()];
            console.log("mappedType", mappedType);
            if (mappedType) {
              console.log("hubspotKey", hubspotKey);
              properties[hubspotKey] = mappedType;
            } else {
              console.warn(
                `⚠️ Skipping invalid lead type "${value}" for ${contact.Email}`
              );
            }
          } else if (hubspotKey === "lead_source_type") {
            const leadSourceType = contact.Lead_Source_Type;
            console.log("leadSourceType", leadSourceType);
            const mappedStatus =
              leadSourceTypeMap[leadSourceType.toLowerCase()];
            console.log(`📧 Mapped lead_source_type: ${mappedStatus}`);
            if (mappedStatus) {
              properties[hubspotKey] = mappedStatus;
              console.log(
                `📧 Mapped lead_source_type (custom): ${mappedStatus}`
              );
            } else {
              console.warn(
                `⚠️ Skipping invalid lead_source_type "${leadSourceType}" for ${contact.Email}`
              );
            }
          } else if (hubspotKey === "icp") {
            const mappedIcp = icpMap[String(value)];
            if (mappedIcp) {
              properties[hubspotKey] = mappedIcp;
            } else {
              console.warn(
                `⚠️ Skipping invalid icp value "${value}" for ${contact.Email}`
              );
            }
          } else if (hubspotKey === "meeting_type") {
            const meetingTypes = contact.Meeting_Type;
            console.log("🟡 Raw Meeting_Type from Zoho:", meetingTypes);

            if (!Array.isArray(meetingTypes) || meetingTypes.length === 0) {
              console.warn(
                `⚠️ No valid meeting_type found for ${contact.Email}`
              );
            } else {
              properties[hubspotKey] = meetingTypes.join(";");
              console.log(`🟡 Mapped meeting_type: ${properties[hubspotKey]}`);
            }
          } else if (hubspotKey === "program") {
            const program = contact.Program;
            console.log("🟡 Raw Program from Zoho:", program);

            if (!Array.isArray(program) || program.length === 0) {
              console.warn(`⚠️ No valid program found for ${contact.Email}`);
            } else {
              properties[hubspotKey] = program.join(";");
              console.log(`🟡 Mapped program: ${properties[hubspotKey]}`);
            }
          } else if (hubspotKey === "linkedin_connected") {
            const linkedinConnected = contact.LinkedIn_Connected;
            console.log(
              "🟡 Raw linkedinConnected from Zoho:",
              linkedinConnected
            );

            if (
              !Array.isArray(linkedinConnected) ||
              linkedinConnected.length === 0
            ) {
              console.warn(
                `⚠️ No valid linkedinConnected found for ${contact.Email}`
              );
            } else {
              properties[hubspotKey] = linkedinConnected.join(";");
              console.log(
                `🟡 Mapped linkedinConnected: ${properties[hubspotKey]}`
              );
            }
          } else if (hubspotKey === "tag") {
            const tag = contact.Tag;
            console.log("🟡 Raw tag from Zoho:", tag);

            if (!Array.isArray(tag) || tag.length === 0) {
              console.warn(
                `⚠️ No valid linkedinConnected found for ${contact.Email}`
              );
              properties[hubspotKey] = ""; // ✅ Send empty string if no tags
            } else {
              properties[hubspotKey] = tag.join(";");
              console.log(`🟡 Mapped tag: ${properties[hubspotKey]}`);
            }
          } else {
            properties[hubspotKey] = value;
          }
        }
      }
      // Add Zoho Lead ID manually
      properties["zoho_lead_id"] = contact.id;
      properties["ownerid"] = contact.Owner?.id;
      // Add BDR ID
      const bdrId = contact.BDR_Owner?.id || "DEFAULT_BDR_ID";
      properties["zoho_bdr_id"] = bdrId;
      //Add modified by id
      const modifiedBy = contact.Modified_By?.id;
      properties["modified_by_id"] = modifiedBy;
      //Add modified by name
      const modifiedByName = contact.Modified_By?.name;
      properties["modified_by_name"] = modifiedByName;
      //Add modified by email
      const modifiedByEmail = contact.Modified_By?.email;
      properties["modified_by_email"] = modifiedByEmail;
      //Add created by id
      const createdBy = contact.Created_By?.id;
      properties["created_by_id"] = createdBy;
      const createdByName = contact.Created_By?.name;
      properties["created_by_name"] = createdByName;
      const createdByEmail = contact.Created_By?.email;
      properties["created_by_email"] = createdByEmail;
      properties["zoho_lead_id"] = contact.Owner?.id;
      properties["zoho_lead_name"] = contact.Owner?.name;
      properties["zoho_lead_email"] = contact.Owner?.email;
      properties["account_id"] = contact.Account_Name?.id;
      properties["account_name"] = contact.Account_Name?.name;
      properties["reporting_to_name"] = contact.Reporting_To?.name;
      properties["reporting_to_id"] = contact.Reporting_To?.id;
      properties["created_time"] = convertToUtcMillis(contact.Created_Time);
      properties["modified_time"] = convertToUtcMillis(contact.Modified_Time);
      properties["last_activity_time"] = convertToUtcMillis(
        contact.Last_Activity_Time
      );
      properties["object_status"] = objectType;

      // Add lead_contact_status from Lead_Status map
      const zohoStatus = contact.Lead_Status;
      const mappedStatus = leadStatusMap[zohoStatus];
      if (mappedStatus) {
        properties["lead_contact_status"] = mappedStatus;
      } else {
        console.warn(
          `⚠️ Skipping invalid lead_contact_status "${zohoStatus}" for ${contact.Email}`
        );
      }

      // Add lead_source from Lead_Source map
      const zohoLeadSource = contact.Lead_Source;
      // console.log(`📧 Lead_Source: ${zohoLeadSource}`);
      const mappedLeadSource =
        leadSourceMap[String(zohoLeadSource).toLowerCase()];
      // console.log(`📧 Mapped lead_source: ${mappedLeadSource}`);
      if (mappedLeadSource) {
        properties["lead_source"] = mappedLeadSource;
      } else {
        console.warn(
          `⚠️ Skipping invalid lead_contact_status "${zohoLeadSource}" for ${contact.Email}`
        );
      }

      // Send to HubSpot
      const payload = { properties };
      console.log(
        `📩 Sending contact ${contact.Email} to HubSpot with payload:`,
        payload
      );
      if (existingId) {
        await axios.patch(
          `https://api.hubapi.com/crm/v3/objects/contacts/${existingId}`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );

        console.log(`✅ Updated contact ${contact.Email}`);
      } else {
        console.log("enter");
        const response = await axios.post(
          `https://api.hubapi.com/crm/v3/objects/contacts`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );
        // console.log("response", response.data);
        console.log(`✅ Created contact ${contact.Email}`);
      }
    } catch (err) {
      let errorMessage;
      if (err.response && err.response.data) {
        console.log("error", err.response.data);
        console.log("err", err.res);
        // console.error(
        //   `❌ Error syncing ${contact.Email} (full response):`,
        //   JSON.stringify(err.response.data, null, 2)
        // );
        errorMessage = JSON.stringify(err.response.data, null, 2);
      } else {
        errorMessage = err.message;
        console.error(`❌ Error syncing ${contact.Email}: ${errorMessage}`);
      }

      errorLogs.push({
        contactId: contact.id,
        email: contact.Email,
        error: errorMessage,
      });
    }
  }

  if (errorLogs.length > 0) {
    fs.writeFileSync(
      CONTACT_ERROR_LOG_FILE,
      JSON.stringify(errorLogs, null, 2)
    );
    console.log(
      `📁 Logged ${errorLogs.length} contact sync errors to ${CONTACT_ERROR_LOG_FILE}`
    );
  }
}
app.get("/zoho/leads", async (req, res) => {
  let tokenObj = await getZohoAccessToken();
  let access_token = tokenObj.access_token;
  // let access_token =
  //   "1000.589d9b4b7eca50a0889930e4381267aa.0f6a5264bb1b89c6381aa7ed139b835d";
  const objectType = "Leads";

  let page = 1;
  let moreRecords = true;

  try {
    const fieldMap = await buildFieldMap(access_token);
    console.log("🔗 Final Mapping:", fieldMap);

    while (moreRecords) {
    // console.log(`📄 Fetching page: ${page}`);

    // const url = `https://www.zohoapis.com/crm/v2/Leads?per_page=5&page=${page}`;
    // const url = "https://www.zohoapis.com/crm/v2/Leads/4582160000122283027";
    // const url = "https://www.zohoapis.com/crm/v2/Leads/4582160000164473794";
    const url = "https://www.zohoapis.com/crm/v2/Leads/4582160000172268005";
    const contactRes = await axios.get(url, {
      headers: {
        Authorization: `Zoho-oauthtoken ${access_token}`,
      },
    });

    const zohoContacts = contactRes.data.data || [];
    console.log("zohoContacts", zohoContacts);
    // console.log(`📦 Fetched ${zohoContacts.length} Zoho contacts on page ${page}`);

    if (zohoContacts.length === 0) {
      moreRecords = false;
      break;
    }

    await syncLeadContactsToHubSpot(zohoContacts, fieldMap, objectType);

    moreRecords = contactRes.data.info?.more_records || false;
    page += 1;
    }

    res.status(200).json({ message: "✅ Zoho contacts synced to HubSpot." });
  } catch (error) {
    const errData = error.response?.data;

    if (errData?.code === "INVALID_TOKEN") {
      console.warn("⚠️ Access token invalid. Refreshing...");
      access_token = await refreshAccessToken(); // You must implement this if not already
      return res
        .status(401)
        .json({ message: "Token refreshed. Please retry." });
    }

    if (
      errData?.code === "RATE_LIMIT_EXCEEDED" ||
      errData?.message?.toLowerCase().includes("rate limit") ||
      errData?.code === "TOO_MANY_REQUESTS"
    ) {
      console.error(`⏳ Rate limit hit. Stopping sync.`);
      return res
        .status(429)
        .json({ error: "Rate limit hit. Try again later." });
    }

    console.error("❌ Unhandled error during sync:", errData || error.message);
    res.status(500).json({
      error: "Failed to sync contacts.",
      details: errData || error.message,
    });
  }
});


async function syncLeadContactsToHubSpot(zohoContacts, fieldMap, objectType) {
  const emailStatusMap = {
    "-None-": "NONE",
    "Request is in progress": "Request is in progress",
    Real: "Existing",
    Fake: "Nonexistent",
    Unknown: "Unknown",
    "Out of limit": "Out of limit",
    "Safe to send": "Safe to send",
  };

  const leadStatusMap = {
    "-None-": "NONE",
    Qualified: "QUALIFIED",
    "Is Not Qualified": "IS_NOT_QUALIFIED",
    "SQL Qualified": "SQL_QUALIFIED",
    "Not Qualified": "NOT_QUALIFIED",
    Unknown: "UNKNOWN",
    Prospect: "PROSPECT",
    "Do Not Call": "DO_NOT_CALL",
    "Do Not Contact": "DO_NOT_CONTACT",
    Customer: "CUSTOMER",
    "Pre-Qualified": "PRE_QUALIFIED",
    Contacted: "CONTACTED",
    "Contact in Future": "CONTACT_IN_FUTURE",
    "Not Contacted": "NOT_CONTACTED",
    "Attempted to Contact": "ATTEMPTED_TO_CONTACT",
    "Lost Lead": "LOST_LEAD",
    "Meeting - Pending": "MEETING_PENDING",
    Nurture: "NURTURE",
    "Meeting - Booked": "MEETING_BOOKED",
    "Channel Partner": "CHANNEL_PARTNER",
    Imported: "IMPORTED",
    "PPC - New": "PPC_NEW",
    Warm: "WARM",
    "Call me": "CALL_ME",
    Inactive: "INACTIVE",
    "Email 4": "EMAIL_4",
    Called: "CALLED",
    "No Phone Number": "NO_PHONE_NUMBER",
    "Left Voicemail": "LEFT_VOICEMAIL",
    "New Lead": "NEW",
    Open: "OPEN",
    "In Progress": "IN_PROGRESS",
    "Open Deal": "OPEN_DEAL",
    Unqualified: "UNQUALIFIED",
    Connected: "CONNECTED",
    "Bad Timing": "BAD_TIMING",
  };
  const leadTypeMap = {
    critical: "Critical",
    hot: "Hot",
    warm: "Warm",
    cold: "Cold",
    "-none-": "-None-",
  };
  const icpMap = {
    Yes: "Yes",
    No: "No",
    "Cant Confirm": "Can't Confirm",
    "-None-": "-None-",
  };
  const leadSourceMap = {
    "-none-": "-None-",
    growth: "Growth",
    organic: "Organic",
    outbound: "Outbound",
    "inside sales": "Inside Sales",
    ppc: "PPC",
    relationship: "Relationship",
    "demo account": "Demo Account",
    "app free trial": "APP_FREE_TRIAL",
    awareness: "AWARENESS",
    casestudydoctustechhelpsboostrafaccuracy: "CASESTUDY",
    "changes between hcc v24 and hcc v28": "VERSION_CHANGES",
    "cold call": "COLD_CALL",
    "cold linkedin outreach": "LINKEDIN_OUTREACH",
    "compliance sme interview": "COMPLIANCE_INTERVIEW",
    "demo account user": "DEMO_USER",
    discovery: "DISCOVERY",
    "ebook measuring the value of value-based care": "EBOOK_VALUE_CARE",
    email: "EMAIL", // 👈 this one matches now
    "existing customer": "EXISTING_CUSTOMER",
    "facebook ads": "FACEBOOK_ADS",
    "hcc audits compliance": "HCC_COMPLIANCE",
    "hcc quick guide": "HCC_GUIDE",
    "integrated platform contact": "INTEGRATED_CONTACT",
    "lead gen form": "LEAD_GEN_FORM",
    "learn about app": "LEARN_ABOUT_APP",
    "learn more - performance max campaign": "PERFORMANCE_MAX",
    "learn with app": "LEARN_APP",
    "learn with doctus": "LEARN_DOCTUS",
    "learn with doctustech": "LEARN_DOCTUSTECH",
    "learn with mobile app": "LEARN_MOBILE_APP",
    "linkedin ads": "LINKEDIN_ADS",
    "linkedin form": "LINKEDIN_FORM",
    "linkedin sales search": "LINKEDIN_SALES_SEARCH",
    "ob aco": "OB_ACO",
    "ob athena": "OB_ATHENA",
    "ob persona": "OB_PERSONA",
    "ob re-engaged": "OB_RE-ENGAGED",
    "personal network": "PERSONAL_NETWORK",
    "radv whitepaper": "RADV_WHITEPAPER",
    "raf revenue calculator": "RAF_REVENUE_CALCULATOR",
    referral: "REFERRAL",
    "risk adjustment one pager": "RISK_ADJUSTMENT_ONE_PAGER",
    "roi calculator": "ROI_Calculator",
    schedule_a_demo: "SCHEDULE1_A_DEMO",
    scupdap: "SCUPDAP",
    seamless: "SEAMLESS",
    "site contact us": "SITE_CONTACT_US",
    tradeshow: "TRADESHOW",
    "visitor insites": "VISITOR_INSITES",
    webinar: "WEBINAR",
    zoominfo: "ZOOMINFO",
    warm: "WARM",
  };
  const leadSourceTypeMap = {
    "-none-": "-None-",
    "demo account": "Demo Account",
    expansion: "Expansion",
    growth: "Growth",
    "inside sales": "Inside Sales",
    organic: "Organic",
    ppc: "PPC",
    relationship: "Relationship",
  };

  const errorLogs = [];

  for (const contact of zohoContacts) {
    try {
      if (!contact.Email) continue;

      const existingId = await hsHelpers.searchContactInHubSpot(contact.Email);
      console.log("🔍 Existing HubSpot Contact ID:", existingId);
      const properties = {};

      for (const [zohoKey, hubspotKeyOriginal] of Object.entries(fieldMap)) {
        if (hubspotKeyOriginal === "lead_stage") {
          console.log(`⏭️ Skipping lead_stage for ${contact.Email}`);
          continue;
        }
        let hubspotKey = hubspotKeyOriginal;
        let value;

        if (zohoKey === "BDR_Owner") {
          value = contact.BDR_Owner?.name || null;
        } else {
          value = contact[zohoKey];
        }
        if (
          value !== null &&
          value !== undefined &&
          (typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean")
        ) {
          // 🛠 Mapping rules
          if (hubspotKey === "zohocheckeremail__email_status") {
            if (emailStatusMap[value]) {
              properties[hubspotKey] = emailStatusMap[value];
            } else {
              console.warn(
                `⚠️ Skipping invalid email status value "${value}" for ${contact.Email}`
              );
            }
          } else if (
            hubspotKey === "zohocheckeremail__secondary_email_status"
          ) {
            if (emailStatusMap[value]) {
              properties[hubspotKey] = emailStatusMap[value];
            } else {
              console.warn(
                `⚠️ Skipping invalid email status value "${value}" for ${contact.Email}`
              );
            }
          } else if (hubspotKey === "lead_type") {
            const mappedType = leadTypeMap[String(value).toLowerCase()];
            console.log("mappedType", mappedType);
            if (mappedType) {
              console.log("hubspotKey", hubspotKey);
              properties[hubspotKey] = mappedType;
            } else {
              console.warn(
                `⚠️ Skipping invalid lead type "${value}" for ${contact.Email}`
              );
            }
          } else if (hubspotKey === "lead_source_type") {
            const leadSourceType = contact.Lead_Source_Bucket;
            console.log("leadSourceType", leadSourceType);
            const mappedStatus =
              leadSourceTypeMap[leadSourceType.toLowerCase()];
            console.log(`📧 Mapped lead_source_type: ${mappedStatus}`);
            if (mappedStatus) {
              properties[hubspotKey] = mappedStatus;
              console.log(
                `📧 Mapped lead_source_type (custom): ${mappedStatus}`
              );
            } else {
              console.warn(
                `⚠️ Skipping invalid lead_source_type "${leadSourceType}" for ${contact.Email}`
              );
            }
          } else if (hubspotKey === "icp") {
            const mappedIcp = icpMap[String(value)];
            if (mappedIcp) {
              properties[hubspotKey] = mappedIcp;
            } else {
              console.warn(
                `⚠️ Skipping invalid icp value "${value}" for ${contact.Email}`
              );
            }
          } else {
            properties[hubspotKey] = value;
          }
        }
      }
      // Add Zoho Lead ID manually
      properties["zoho_lead_id"] = contact.id;
      console.log(`🆔 Added Zoho_Lead_Id: ${contact.id}`);

      // Add BDR ID
      const bdrId = contact.BDR_Owner?.id || "DEFAULT_BDR_ID";
      properties["zoho_bdr_id"] = bdrId;
      console.log(`👤 Added zoho_bdr_id: ${bdrId}`);

      //Add modified by id
      const modifiedBy = contact.Modified_By?.id;
      properties["modified_by_id"] = modifiedBy;
      console.log(`👤 Added modified_by_id: ${modifiedBy}`);

      //Add modified by name
      const modifiedByName = contact.Modified_By?.name;
      properties["modified_by_name"] = modifiedByName;
      console.log(`👤 Added modified_by_name: ${modifiedByName}`);

      //Add modified by email
      const modifiedByEmail = contact.Modified_By?.email;
      properties["modified_by_email"] = modifiedByEmail;
      console.log(`👤 Added modified_by_email: ${modifiedByEmail}`);

      //Add created by id
      const createdBy = contact.Created_By?.id;
      properties["created_by_id"] = createdBy;
      console.log(`👤 Added created_by_id: ${createdBy}`);

      //Add created by name
      const createdByName = contact.Created_By?.name;
      properties["created_by_name"] = createdByName;
      console.log(`👤 Added created_by_name: ${createdByName}`);

      //Add created by email
      const createdByEmail = contact.Created_By?.email;
      properties["created_by_email"] = createdByEmail;
      console.log(`👤 Added created_by_email: ${createdByEmail}`);

      //Add zoho_lead_id
      properties["zoho_lead_id"] = contact.Owner?.id;
      console.log(`🆔 Added Zoho_Lead_Id: ${contact.id}`);
      //add zoho_lead_name
      properties["zoho_lead_name"] = contact.Owner?.name;
      console.log(`🆔 Added Zoho_Lead_Name: ${contact.Owner?.name}`);
      //add zoho_lead_email
      properties["zoho_lead_email"] = contact.Owner?.email;
      console.log(`🆔 Added Zoho_Lead_Email: ${contact.Owner?.email}`);
      // Add lead_contact_status from Lead_Status map
      const zohoStatus = contact.Lead_Status;
      console.log(`📧 Lead_Status: ${zohoStatus}`);
      const mappedStatus = leadStatusMap[zohoStatus];
      console.log(`📧 Mapped lead_contact_status: ${mappedStatus}`);
      if (mappedStatus) {
        properties["lead_contact_status"] = mappedStatus;
        console.log(`📧 Mapped lead_contact_status (custom): ${mappedStatus}`);
      } else {
        console.warn(
          `⚠️ Skipping invalid lead_contact_status "${zohoStatus}" for ${contact.Email}`
        );
      }
      properties["object_status"] = objectType;

      // Add lead_source from Lead_Source map
      const zohoLeadSource = contact.Lead_Source;
      console.log(`📧 Lead_Source: ${zohoLeadSource}`);
      const mappedLeadSource =
        leadSourceMap[String(zohoLeadSource).toLowerCase()];
      console.log(`📧 Mapped lead_source: ${mappedLeadSource}`);
      if (mappedLeadSource) {
        properties["lead_source"] = mappedLeadSource;
      } else {
        console.warn(
          `⚠️ Skipping invalid lead_contact_status "${zohoLeadSource}" for ${contact.Email}`
        );
      }
      // Send to HubSpot
      const payload = { properties };
      console.log(
        `📩 Sending contact ${contact.Email} to HubSpot with payload:`,
        payload
      );
      if (existingId) {
        await axios.patch(
          `https://api.hubapi.com/crm/v3/objects/contacts/${existingId}`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );

        console.log(`✅ Updated contact ${contact.Email}`);
      } else {
        console.log("payload", payload);
        console.log("HUBSPOT_ACCESS_TOKEN", HUBSPOT_ACCESS_TOKEN);
        console.log("enter");
        const response = await axios.post(
          `https://api.hubapi.com/crm/v3/objects/contacts`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );
        console.log("response", response.data);
        console.log(`✅ Created contact ${contact.Email}`);
      }
    } catch (err) {
      let errorMessage;
      if (err.response && err.response.data) {
        console.log("error", err.response.data);
        console.log("err", err.res);
        // console.error(
        //   `❌ Error syncing ${contact.Email} (full response):`,
        //   JSON.stringify(err.response.data, null, 2)
        // );
        errorMessage = JSON.stringify(err.response.data, null, 2);
      } else {
        errorMessage = err.message;
        console.error(`❌ Error syncing ${contact.Email}: ${errorMessage}`);
      }

      errorLogs.push({
        contactId: contact.id,
        email: contact.Email,
        error: errorMessage,
      });
    }
  }

  if (errorLogs.length > 0) {
    fs.writeFileSync(
      CONTACT_ERROR_LOG_FILE,
      JSON.stringify(errorLogs, null, 2)
    );
    console.log(
      `📁 Logged ${errorLogs.length} contact sync errors to ${CONTACT_ERROR_LOG_FILE}`
    );
  }
}

function convertToUtcMillis(dateStr) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  return isNaN(date) ? null : date.getTime();
}
app.get("/zoho/accounts", async (req, res) => {
  let tokenObj = await getZohoAccessToken();
  let access_token = tokenObj.access_token;
  // let access_token =
  //   "1000.dfdcdeb8ebc7d3163957f46b0256e186.ac0609517833953aa1dbce17c416a9ed";

  let page = 1;
  let moreRecords = true;

  try {
    const fieldMap = await buildFieldMap(access_token);
    console.log("🔗 Final Mapping:", fieldMap);

    while (moreRecords) {
    console.log(`📄 Fetching page: ${page}`);

    // const url = `https://www.zohoapis.com/crm/v2/Leads?per_page=5&page=${page}`;
    // const url = "https://www.zohoapis.com/crm/v2/Accounts/4582160000171491017";
    const url = "https://www.zohoapis.com/crm/v2/Accounts/4582160000116722036";

    const accountRes = await axios.get(url, {
      headers: {
        Authorization: `Zoho-oauthtoken ${access_token}`,
      },
    });

    const zohoAccounts = accountRes.data.data || [];
    console.log("zohoAccounts", zohoAccounts);
    // console.log(`📦 Fetched ${zohoAccounts.length} Zoho contacts on page ${page}`);

    if (zohoContacts.length === 0) {
      moreRecords = false;
      break;
    }

    await syncAccountsToHubSpot(zohoAccounts, fieldMap);

    moreRecords = contactRes.data.info?.more_records || false;
    page += 1;
    }

    res.status(200).json({ message: "✅ Zoho contacts synced to HubSpot." });
  } catch (error) {
    const errData = error.response?.data;

    if (errData?.code === "INVALID_TOKEN") {
      console.warn("⚠️ Access token invalid. Refreshing...");
      access_token = await refreshAccessToken(); // You must implement this if not already
      return res
        .status(401)
        .json({ message: "Token refreshed. Please retry." });
    }

    if (
      errData?.code === "RATE_LIMIT_EXCEEDED" ||
      errData?.message?.toLowerCase().includes("rate limit") ||
      errData?.code === "TOO_MANY_REQUESTS"
    ) {
      console.error(`⏳ Rate limit hit. Stopping sync.`);
      return res
        .status(429)
        .json({ error: "Rate limit hit. Try again later." });
    }

    console.error("❌ Unhandled error during sync:", errData || error.message);
    res.status(500).json({
      error: "Failed to sync contacts.",
      details: errData || error.message,
    });
  }
});
async function syncAccountsToHubSpot(zohoAccounts, fieldMap) {
  const leadStatusMap = {
    "-None-": "NONE",
    Qualified: "QUALIFIED",
    "Not Qualified": "NOT_QUALIFIED",
    Nurture: "NURTURE",
    "Do Not Contact": "DO_NOT_CONTACT",
    "Channel Partner": "CHANNEL_PARTNER",
    Inactive: "INACTIVE",
    Warm: "WARM",
    Prospect: "PROSPECT",
    "Meeting - Pending": "MEETING_PENDING",
    "Meeting - Booked": "MEETING_BOOKED",
    Imported: "IMPORTED",
    "PPC - New": "PPC_NEW",
    "Do Not Call": "DO_NOT_CALL",
    "Call me": "CALL_ME",
    "SQL Qualified": "SQL_QUALIFIED",
  };

  const leadSourceMap = {
    "-none-": "-None-",
    "campaign email": "Campaign Email",
    "scu pdap": "SCU PDAP",
    chat: "Chat",
    cleverly: "Cleverly",
    "cold call": "Cold Call",
    "cold linkedin outreach": "Cold LinkedIn Outreach",
    growth: "Growth",
    "linkedin sales search": "LinkedIn Sales Search",
    "zoominfo sales search": "ZoomInfo Sales Search",
    "hcc audits compliance": "HCC Audits Compliance",
    "hcc quick guide": "HCC QUICK GUIDE",
    inbound: "Inbound",
    "integrated platform contact": "INTEGRATED PLATFORM CONTACT",
    "learn with app": "LEARN WITH APP",
    "linkedin form": "LINKEDIN FORM",
    "linkedin salesnav": "LinkedIn SalesNav",
    "noi digitial": "NOI Digitial",
    "oppt drive": "Oppt Drive",
    "personal network": "Personal Network",
    "prior connection": "Prior Connection",
    "radv whitepaper": "RADV WHITEPAPER",
    referral: "Referral",
    "schedule a demo": "SCHEDULE A DEMO",
    seamless: "Seamless",
    "site contact us": "SITE CONTACT US",
    "visitor insites": "Visitor InSites",
    webinar: "Webinar",
    "website visit": "Website Visit",
    yamm: "YAMM",
    "learn more - performance max campaign":
      "Learn More - Performance Max Campaign",
    "ob aco": "OB ACO",
    "ob persona": "OB Persona",
    "ob re-engaged": "OB Re-Engaged",
    "ob athena": "OB Athena",
    "changes between hcc v24 and hcc v28":
      "Changes between HCC V24 and HCC V28",
    "ebook measuring the value of value-based care":
      "Ebook Measuring the value of value-based care",
    "compliance sme interview": "Compliance SME interview",
    "raf revenue calculator": "RAF revenue calculator",
    "risk adjustment one pager": "Risk adjustment one pager",
    casestudydoctustechhelpsboostrafaccuracy:
      "CasestudyDoctusTechHelpsboostRAFaccuracy",
  };

  const leadTypeMap = {
    critical: "Critical",
    hot: "Hot",
    warm: "Warm",
    cold: "Cold",
    "-none-": "-None-",
  };

  const categoryMap = {
    "-none-": "-None-",
    "primary care": "Primary Care",
    "palliative care": "Palliative Care",
    "aco / aco reach": "ACO",
    aco: "ACO",
    other: "Other",
  };
  const leadSourceTypeMap = {
    "-none-": "-None-",
    growth: "Growth",
    organic: "Organic",
    referral: "Referral",
    outbound: "Outbound",
    "inside sales": "Inside Sales",
    ppc: "PPC",
    relationship: "Relationship",
  };

  const errorLogs = [];

  const normalize = (str) =>
    String(str || "")
      .trim()
      .toLowerCase();

  for (const accounts of zohoAccounts) {
    try {
      if (!accounts.Email) continue;

      const existingId = await hsHelpers.searchCompanyInHubSpot(
        accounts.Account_Name
      );
      console.log("existingId", existingId);
      const properties = {};

      for (const [zohoKey, hubspotKey] of Object.entries(fieldMap)) {
        let value = accounts[zohoKey];

        if (
          value !== null &&
          value !== undefined &&
          (typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean")
        ) {
          const valueStr = String(value).trim();
          const normalizedValue = normalize(valueStr);
          // console.log("normalizedValue", normalizedValue);
          if (hubspotKey === "lead_type") {
            const mapped = leadTypeMap[normalizedValue];
            if (mapped) {
              properties[hubspotKey] = mapped;
              continue;
            } else {
              console.warn(
                `⚠️ Skipping invalid lead_type "${valueStr}" for ${accounts.Email}`
              );
              continue;
            }
          }

          if (hubspotKey === "lead_source_type") {
            const mapped = leadSourceTypeMap[normalizedValue];
            if (mapped) {
              properties[hubspotKey] = mapped;
              continue;
            } else {
              // properties[hubspotKey]=accounts.Lead_Source
              console.warn(
                `⚠️ Skipping invalid lead_source_type "${valueStr}" for ${accounts.Email}`
              );
              continue;
            }
          }

          if (hubspotKey === "category") {
            const mapped = categoryMap[normalizedValue];
            if (mapped) {
              properties[hubspotKey] = mapped;
              continue;
            } else {
              console.warn(
                `⚠️ Skipping invalid category "${valueStr}" for ${accounts.Email}`
              );
              continue;
            }
          }
          if (hubspotKey === "lead_source") {
            const mapped = leadSourceMap[normalizedValue];
            console.log("mapped", mapped);
            if (mapped) {
              console.log("hubspotKey", hubspotKey);
              properties[hubspotKey] = mapped;
              continue;
            } else {
              // console.log("valueStr", valueStr);
              properties[hubspotKey] = accounts.Lead_Source;
              console.warn(
                `⚠️ Skipping invalid lead_source "${valueStr}" for ${accounts.Email}`
              );
              continue;
            }
          }
          if (hubspotKey === "title") {
            console.warn(
              `⏭️ Skipping unmapped property "title" for ${accounts.Email}`
            );
            continue;
          }

          // fallback if not a mapped field
          properties[hubspotKey] = valueStr;
        }
      }
      // Add Zoho Lead ID manually
      properties["zoho_company_id"] = accounts.id;
      console.log(`🆔 Added Zoho_Company_Id: ${accounts.id}`);

      // Add BDR ID
      const bdrId = accounts.BDR_Owner?.id || "DEFAULT_BDR_ID";
      properties["zoho_bdr_id"] = bdrId;
      console.log(`👤 Added zoho_bdr_id: ${bdrId}`);

      const zohoStatus = accounts.Status;
      const mappedStatus = leadStatusMap[zohoStatus];
      if (mappedStatus) {
        properties["company_status"] = mappedStatus;
      } else {
        console.warn(
          `⚠️ Skipping invalid company_status "${zohoStatus}" for ${accounts.Email}`
        );
      }

      const payload = { properties };
      console.log(
        `📩 Sending account ${accounts.Email} to HubSpot with payload:`,
        payload
      );

      if (existingId) {
        await axios.patch(
          `https://api.hubapi.com/crm/v3/objects/companies/${existingId}`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );
        console.log(`✅ Updated account ${accounts.Email}`);
      } else {
        await axios.post(
          `https://api.hubapi.com/crm/v3/objects/companies`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );
        console.log(`✅ Created account ${accounts.Email}`);
      }
    } catch (err) {
      const errorMessage =
        err.response?.data?.message ||
        JSON.stringify(err.response?.data) ||
        err.message;
      console.error(`❌ Error syncing ${accounts.Email}:`, errorMessage);
      errorLogs.push({
        contactId: accounts.id,
        email: accounts.Email,
        error: errorMessage,
      });
    }
  }

  if (errorLogs.length > 0) {
    fs.writeFileSync(
      CONTACT_ERROR_LOG_FILE,
      JSON.stringify(errorLogs, null, 2)
    );
    console.log(
      `📁 Logged ${errorLogs.length} account sync errors to ${CONTACT_ERROR_LOG_FILE}`
    );
  }
}



// async function syncDealsToHubSpot(zohoDeals, fieldMap) {
//   const leadStatusMap = {
//     "-None-": "NONE",
//     Qualified: "QUALIFIED",
//     "Not Qualified": "NOT_QUALIFIED",
//     Nurture: "NURTURE",
//     "Do Not Contact": "DO_NOT_CONTACT",
//     "Channel Partner": "CHANNEL_PARTNER",
//     Inactive: "INACTIVE",
//     Warm: "WARM",
//     Prospect: "PROSPECT",
//     "Meeting - Pending": "MEETING_PENDING",
//     "Meeting - Booked": "MEETING_BOOKED",
//     Imported: "IMPORTED",
//     "PPC - New": "PPC_NEW",
//     "Do Not Call": "DO_NOT_CALL",
//     "Call me": "CALL_ME",
//     "SQL Qualified": "SQL_QUALIFIED"
//   };

//   const leadSourceMap = {
//     "-none-": "-None-",
//     "campaign email": "Campaign Email",
//     "scu pdap": "SCU PDAP",
//     "chat": "Chat",
//     "cleverly": "Cleverly",
//     "cold call": "Cold Call",
//     "cold linkedin outreach": "Cold LinkedIn Outreach",
//     "growth": "Growth",
//     "linkedin sales search": "LinkedIn Sales Search",
//     "zoominfo sales search": "ZoomInfo Sales Search",
//     "hcc audits compliance": "HCC Audits Compliance",
//     "hcc quick guide": "HCC QUICK GUIDE",
//     "inbound": "Inbound",
//     "integrated platform contact": "INTEGRATED PLATFORM CONTACT",
//     "learn with app": "LEARN WITH APP",
//     "linkedin form": "LINKEDIN FORM",
//     "linkedin salesnav": "LinkedIn SalesNav",
//     "noi digitial": "NOI Digitial",
//     "oppt drive": "Oppt Drive",
//     "personal network": "Personal Network",
//     "prior connection": "Prior Connection",
//     "radv whitepaper": "RADV WHITEPAPER",
//     "referral": "Referral",
//     "schedule a demo": "SCHEDULE A DEMO",
//     "seamless": "Seamless",
//     "site contact us": "SITE CONTACT US",
//     "visitor insites": "Visitor InSites",
//     "webinar": "Webinar",
//     "website visit": "Website Visit",
//     "yamm": "YAMM",
//     "learn more - performance max campaign": "Learn More - Performance Max Campaign",
//     "ob aco": "OB ACO",
//     "ob persona": "OB Persona",
//     "ob re-engaged": "OB Re-Engaged",
//     "ob athena": "OB Athena",
//     "changes between hcc v24 and hcc v28": "Changes between HCC V24 and HCC V28",
//     "ebook measuring the value of value-based care": "Ebook Measuring the value of value-based care",
//     "compliance sme interview": "Compliance SME interview",
//     "raf revenue calculator": "RAF revenue calculator",
//     "risk adjustment one pager": "Risk adjustment one pager",
//     "casestudydoctustechhelpsboostrafaccuracy": "CasestudyDoctusTechHelpsboostRAFaccuracy"
//   };

//   const leadTypeMap = {
//     "critical": "Critical",
//     "hot": "Hot",
//     "warm": "Warm",
//     "cold": "Cold",
//     "-none-": "-None-",
//   };

//   const categoryMap = {
//     "-none-": "-None-",
//     "primary care": "Primary Care",
//     "palliative care": "Palliative Care",
//     "aco / aco reach": "ACO",
//     "aco": "ACO",
//     "other": "Other"
//   };

//   const leadSourceTypeMap = {
//     "-none-": "-None-",
//     "growth": "Growth",
//     "organic": "Organic",
//     "referral": "Referral",
//     "outbound": "Outbound",
//     "inside sales": "Inside Sales",
//     "ppc": "PPC",
//     "relationship": "Relationship",
//   };

//   const pipelineMapping = {
//     "Sales Pipeline": "default",
//     "Standard": "156390782",
//   };

//   const dealStageMapping = {
//     "Sales Pipeline": {
//       "SAL": "1100460157",
//       "Qualification": "1100460158",
//       "Evaluation": "1100460159",
//       "Proposal": "1100460160",
//       "Commit": "1100460161",
//       "Closed Lost": "closedlost",
//       "Closed won": "closedwon",
//     },
//     "Standard": {
//       "SAL": "1100468105",
//       "Qualification": "1100335648",
//       "Evaluation": "1100335648",
//       "Proposal": "1100335650",
//       "Commit": "1100335651",
//       "Closed Lost": "262732853",
//       "Closed won": "262732852",
//     },
//   };

//   const errorLogs = [];
//   const normalize = (str) => String(str || "").trim().toLowerCase();

//   for (const deals of zohoDeals) {
//     try {
//       if (!deals.Email) continue;

//       const existingId = await hsHelpers.searchDealInHubSpot(deals.Deal_Name);
//       console.log("existingId", existingId);
//       const properties = {};

//       for (const [zohoKey, hubspotKey] of Object.entries(fieldMap)) {
//         let value = deals[zohoKey];

//         if (value !== null && value !== undefined &&
//           (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
//         ) {
//           const valueStr = String(value).trim();
//           const normalizedValue = normalize(valueStr);

//           if (hubspotKey === "lead_type") {
//             const mapped = leadTypeMap[normalizedValue];
//             if (mapped) {
//               properties[hubspotKey] = mapped;
//               continue;
//             } else {
//               console.warn(`⚠️ Skipping invalid lead_type "${valueStr}" for ${deals.Email}`);
//               continue;
//             }
//           }

//           if (hubspotKey === "lead_source_type") {
//             const mapped = leadSourceTypeMap[normalizedValue];
//             if (mapped) {
//               properties[hubspotKey] = mapped;
//               continue;
//             } else {
//               console.warn(`⚠️ Skipping invalid lead_source_type "${valueStr}" for ${deals.Email}`);
//               continue;
//             }
//           }

//           if (hubspotKey === "category") {
//             const mapped = categoryMap[normalizedValue];
//             if (mapped) {
//               properties[hubspotKey] = mapped;
//               continue;
//             } else {
//               console.warn(`⚠️ Skipping invalid category "${valueStr}" for ${deals.Email}`);
//               continue;
//             }
//           }

//           if (hubspotKey === "lead_source") {
//             const mapped = leadSourceMap[normalizedValue];
//             properties[hubspotKey] = mapped || valueStr;
//             continue;
//           }

//           if (hubspotKey === "title") {
//             console.warn(`⏭️ Skipping unmapped property "title" for ${deals.Email}`);
//             continue;
//           }

//           properties[hubspotKey] = valueStr;
//         }
//       }

//       // Add Zoho Lead ID and BDR ID
//       // properties["zoho_lead_id"] = deals.id;
//       // console.log(`🆔 Added Zoho_Lead_Id: ${deals.id}`);

//       // const bdrId = deals.BDR_Owner?.id || "DEFAULT_BDR_ID";
//       // properties["zoho_bdr_id"] = bdrId;
//       // console.log(`👤 Added zoho_bdr_id: ${bdrId}`);

//       // Add mapped company status
//       const zohoStatus = deals.Status;
//       const mappedStatus = leadStatusMap[zohoStatus];
//       if (mappedStatus) {
//         properties["company_status"] = mappedStatus;
//       } else {
//         console.warn(`⚠️ Skipping invalid company_status "${zohoStatus}" for ${deals.Email}`);
//       }

//       // 🔁 Map Pipeline and Deal Stage
//       const displayLabel = deals?.$layout_id?.display_label || "Sales Pipeline";
//       console.log(`🔁 Mapping pipeline  for "${displayLabel}"`);
//       const zohoStage = deals?.Stage;
//       console.log(`🔁 Mapping pipeline  for "${zohoStage}"`);
//       const pipelineId = pipelineMapping[displayLabel] || "default";
//       console.log(`🔁 Mapping pipeline  for "${pipelineId}"`);
//       properties["pipeline"] = pipelineId;

//       const stageId = dealStageMapping[displayLabel]?.[zohoStage];
//       console.log(`🔁 Mapping stage  for "${stageId}"`);
//       if (stageId) {
//         properties["dealstage"] = stageId;
//       } else {
//         console.warn(`⚠️ Stage "${zohoStage}" not mapped in "${displayLabel}", skipping dealstage`);
//       }

//       const payload = { properties };
//       console.log(`📩 Sending account ${deals.Email} to HubSpot with payload:`, payload);

//       if (existingId) {
//         await axios.patch(
//           `https://api.hubapi.com/crm/v3/objects/deals/${existingId}`,
//           payload,
//           {
//             headers: {
//               Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
//               "Content-Type": "application/json",
//             },
//           }
//         );
//         console.log(`✅ Updated deal ${deals.Email}`);
//       } else {
//         await axios.post(
//           `https://api.hubapi.com/crm/v3/objects/deals`,
//           payload,
//           {
//             headers: {
//               Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
//               "Content-Type": "application/json",
//             },
//           }
//         );
//         console.log(`✅ Created deal ${deals.Email}`);
//       }

//     } catch (err) {
//       const errorMessage =
//         err.response?.data?.message ||
//         JSON.stringify(err.response?.data) ||
//         err.message;
//       console.error(`❌ Error syncing ${deals.Email}:`, errorMessage);
//       errorLogs.push({
//         contactId: deals.id,
//         email: deals.Email,
//         error: errorMessage,
//       });
//     }
//   }

//   if (errorLogs.length > 0) {
//     fs.writeFileSync(
//       CONTACT_ERROR_LOG_FILE,
//       JSON.stringify(errorLogs, null, 2)
//     );
//     console.log(`📁 Logged ${errorLogs.length} deal sync errors to ${CONTACT_ERROR_LOG_FILE}`);
//   }
// }
async function syncDealsToHubSpot(zohoDeals, fieldMap) {
  const leadStatusMap = {
    "-None-": "NONE",
    Qualified: "QUALIFIED",
    "Not Qualified": "NOT_QUALIFIED",
    Nurture: "NURTURE",
    "Do Not Contact": "DO_NOT_CONTACT",
    "Channel Partner": "CHANNEL_PARTNER",
    Inactive: "INACTIVE",
    Warm: "WARM",
    Prospect: "PROSPECT",
    "Meeting - Pending": "MEETING_PENDING",
    "Meeting - Booked": "MEETING_BOOKED",
    Imported: "IMPORTED",
    "PPC - New": "PPC_NEW",
    "Do Not Call": "DO_NOT_CALL",
    "Call me": "CALL_ME",
    "SQL Qualified": "SQL_QUALIFIED",
  };

  const leadSourceMap = {
    "-none-": "-None-",
    "campaign email": "Campaign Email",
    "scu pdap": "SCU PDAP",
    chat: "Chat",
    cleverly: "Cleverly",
    "cold call": "Cold Call",
    "cold linkedin outreach": "Cold LinkedIn Outreach",
    growth: "Growth",
    "linkedin sales search": "LinkedIn Sales Search",
    "zoominfo sales search": "ZoomInfo Sales Search",
    "hcc audits compliance": "HCC Audits Compliance",
    "hcc quick guide": "HCC QUICK GUIDE",
    inbound: "Inbound",
    "integrated platform contact": "INTEGRATED PLATFORM CONTACT",
    "learn with app": "LEARN WITH APP",
    "linkedin form": "LINKEDIN FORM",
    "linkedin salesnav": "LinkedIn SalesNav",
    "noi digitial": "NOI Digitial",
    "oppt drive": "Oppt Drive",
    "personal network": "Personal Network",
    "prior connection": "Prior Connection",
    "radv whitepaper": "RADV WHITEPAPER",
    referral: "Referral",
    "schedule a demo": "SCHEDULE A DEMO",
    seamless: "Seamless",
    "site contact us": "SITE CONTACT US",
    "visitor insites": "Visitor InSites",
    webinar: "Webinar",
    "website visit": "Website Visit",
    yamm: "YAMM",
    "learn more - performance max campaign":
      "Learn More - Performance Max Campaign",
    "ob aco": "OB ACO",
    "ob persona": "OB Persona",
    "ob re-engaged": "OB Re-Engaged",
    "ob athena": "OB Athena",
    "changes between hcc v24 and hcc v28":
      "Changes between HCC V24 and HCC V28",
    "ebook measuring the value of value-based care":
      "Ebook Measuring the value of value-based care",
    "compliance sme interview": "Compliance SME interview",
    "raf revenue calculator": "RAF revenue calculator",
    "risk adjustment one pager": "Risk adjustment one pager",
    casestudydoctustechhelpsboostrafaccuracy:
      "CasestudyDoctusTechHelpsboostRAFaccuracy",
  };

  const leadTypeMap = {
    critical: "Critical",
    hot: "Hot",
    warm: "Warm",
    cold: "Cold",
    "-none-": "-None-",
  };

  const categoryMap = {
    "-none-": "-None-",
    "primary care": "Primary Care",
    "palliative care": "Palliative Care",
    "aco / aco reach": "ACO",
    aco: "ACO",
    other: "Other",
  };

  const leadSourceTypeMap = {
    "-none-": "-None-",
    growth: "Growth",
    organic: "Organic",
    referral: "Referral",
    outbound: "Outbound",
    "inside sales": "Inside Sales",
    ppc: "PPC",
    relationship: "Relationship",
  };

  const pipelineMapping = {
    "Sales Pipeline": "default",
    Standard: "156390782",
  };

  const dealStageMapping = {
    "Sales Pipeline": {
      SAL: "1100460157",
      Qualification: "1100460158",
      Evaluation: "1100460159",
      Proposal: "1100460160",
      Commit: "1100460161",
      "Closed Lost": "closedlost",
      "Closed won": "closedwon",
    },
    Standard: {
      SAL: "1100468105",
      Qualification: "1100335648",
      Evaluation: "1100335648",
      Proposal: "1100335650",
      Commit: "1100335651",
      "Closed Lost": "262732853",
      "Closed won": "262732852",
    },
  };
  const normalize = (str) =>
    String(str || "")
      .trim()
      .toLowerCase();
  const errorLogs = [];

  for (const deals of zohoDeals) {
    try {
      if (!deals.Deal_Name) {
        console.warn("⛔ Skipping deal with missing Deal_Name.");
        continue;
      }

      console.log(`🔍 Looking up deal: "${deals.Deal_Name}"`);
      const existingId = await hsHelpers.searchDealInHubSpot(deals.Deal_Name);
      console.log("🔎 Existing HubSpot Deal ID:", existingId || "Not found");

      const properties = {};

      console.log("📋 Mapping Zoho fields to HubSpot properties...");
      for (const [zohoKey, hubspotKey] of Object.entries(fieldMap)) {
        const value = deals[zohoKey];

        if (
          value !== null &&
          value !== undefined &&
          (typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean")
        ) {
          const valueStr = String(value).trim();
          const normalizedValue = normalize(valueStr);

          console.log(
            `🔁 Mapping field: ${zohoKey} -> ${hubspotKey} = "${valueStr}"`
          );

          if (hubspotKey === "lead_type") {
            const mapped = leadTypeMap[normalizedValue];
            if (mapped) {
              properties[hubspotKey] = mapped;
              console.log(`✅ Mapped lead_type: ${valueStr} -> ${mapped}`);
            } else {
              console.warn(`⚠️ Invalid lead_type "${valueStr}"`);
            }
            continue;
          }

          if (hubspotKey === "lead_source_type") {
            const mapped = leadSourceTypeMap[normalizedValue];
            if (mapped) {
              properties[hubspotKey] = mapped;
              console.log(
                `✅ Mapped lead_source_type: ${valueStr} -> ${mapped}`
              );
            } else {
              console.warn(`⚠️ Invalid lead_source_type "${valueStr}"`);
            }
            continue;
          }

          if (hubspotKey === "category") {
            const mapped = categoryMap[normalizedValue];
            if (mapped) {
              properties[hubspotKey] = mapped;
              console.log(`✅ Mapped category: ${valueStr} -> ${mapped}`);
            } else {
              console.warn(`⚠️ Invalid category "${valueStr}"`);
            }
            continue;
          }

          if (hubspotKey === "lead_source") {
            const mapped = leadSourceMap[normalizedValue];
            properties[hubspotKey] = mapped || valueStr;
            console.log(
              `✅ Mapped lead_source: ${valueStr} -> ${properties[hubspotKey]}`
            );
            continue;
          }

          if (hubspotKey === "title") {
            console.warn(`⏭️ Skipping unmapped property "title"`);
            continue;
          }

          if (hubspotKey === "email") {
            console.warn(`⛔ Skipping invalid deal property "email"`);
            continue;
          }

          properties[hubspotKey] = valueStr;
          console.log(`✅ Added property: ${hubspotKey} = "${valueStr}"`);
        }
      }

      // ✅ Company Status Mapping
      const zohoStatus = deals.Status;
      const mappedStatus = leadStatusMap[zohoStatus];
      if (mappedStatus) {
        properties["company_status"] = mappedStatus;
        console.log(
          `✅ Mapped company_status: ${zohoStatus} -> ${mappedStatus}`
        );
      } else {
        console.warn(`⚠️ Invalid company_status "${zohoStatus}"`);
      }

      // 🔁 Pipeline and Deal Stage Mapping
      const displayLabelRaw =
        deals?.$layout_id?.display_label || "Sales Pipeline";
      const displayLabel = normalize(displayLabelRaw);
      console.log("displayLabel", displayLabel);
      const matchedPipelineKey = Object.keys(pipelineMapping).find(
        (key) => normalize(key) === displayLabel
      );
      console.log("matchedPipelineKey", matchedPipelineKey);
      const pipelineId = pipelineMapping[matchedPipelineKey] || "default";
      properties["pipeline"] = pipelineId;

      console.log(
        `🧭 Pipeline mapping: "${displayLabelRaw}" -> "${
          matchedPipelineKey || "default"
        }" (${pipelineId})`
      );

      const stageRaw = deals?.Stage || "";
      const stageLabel = normalize(stageRaw);
      const matchedStageKey = Object.keys(
        dealStageMapping[matchedPipelineKey] || {}
      ).find((stage) => normalize(stage) === stageLabel);
      console.log("matchedStageKey", matchedStageKey);
      const stageId = dealStageMapping[matchedPipelineKey]?.[matchedStageKey];
      console.log("stageId", stageId);
      if (stageId) {
        properties["deal_stage"] = stageId;
        console.log(
          `🪜 Deal stage mapping: "${stageRaw}" -> "${matchedStageKey}" (${stageId})`
        );
      } else {
        console.warn(
          `⚠️ Stage "${stageRaw}" not mapped under pipeline "${matchedPipelineKey}"`
        );
      }

      // 📦 Final Payload
      const payload = { properties };
      console.log(`📤 Payload ready for "${deals.Deal_Name}":`, payload);

      // 🚀 Send to HubSpot
      const hubspotUrl = existingId
        ? `https://api.hubapi.com/crm/v3/objects/deals/${existingId}`
        : `https://api.hubapi.com/crm/v3/objects/deals`;

      const method = existingId ? axios.patch : axios.post;

      await method(hubspotUrl, payload, {
        headers: {
          Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      });

      console.log(
        `✅ Deal ${existingId ? "updated" : "created"}: "${deals.Deal_Name}"`
      );
    } catch (err) {
      const errorMessage =
        err.response?.data?.message ||
        JSON.stringify(err.response?.data) ||
        err.message;
      console.error(
        `❌ Error syncing deal "${deals.Deal_Name}":`,
        errorMessage
      );
      errorLogs.push({
        contactId: deals.id,
        dealName: deals.Deal_Name,
        error: errorMessage,
      });
    }
  }

  if (errorLogs.length > 0) {
    fs.writeFileSync(
      CONTACT_ERROR_LOG_FILE,
      JSON.stringify(errorLogs, null, 2)
    );
    console.log(
      `📁 Logged ${errorLogs.length} deal sync errors to ${CONTACT_ERROR_LOG_FILE}`
    );
  } else {
    console.log("🎉 All deals synced successfully.");
  }
}

app.get("/zoho/deals", async (req, res) => {
  let tokenObj = await getZohoAccessToken();
  let access_token = tokenObj.access_token;
  // let access_token =
  //   "1000.dfdcdeb8ebc7d3163957f46b0256e186.ac0609517833953aa1dbce17c416a9ed";

  let page = 1;
  let moreRecords = true;

  try {
    const fieldMap = await buildFieldMap(access_token);
    console.log("🔗 Final Mapping:", fieldMap);

    while (moreRecords) {
    console.log(`📄 Fetching page: ${page}`);

    // const url = `https://www.zohoapis.com/crm/v2/Leads?per_page=5&page=${page}`;
    // const url = "https://www.zohoapis.com/crm/v2/Accounts/4582160000171491017";
    const url = "https://www.zohoapis.com/crm/v2/Deals/4582160000171395158";

    const dealRes = await axios.get(url, {
      headers: {
        Authorization: `Zoho-oauthtoken ${access_token}`,
      },
    });

    const zohoDeals = dealRes.data.data || [];
    console.log("zohoDeals", zohoDeals);
    // console.log(`📦 Fetched ${zohoAccounts.length} Zoho contacts on page ${page}`);

    if (zohoContacts.length === 0) {
      moreRecords = false;
      break;
    }

    await syncDealsToHubSpot(zohoDeals, fieldMap);

    moreRecords = contactRes.data.info?.more_records || false;
    page += 1;
    }

    res.status(200).json({ message: "✅ Zoho contacts synced to HubSpot." });
  } catch (error) {
    const errData = error.response?.data;

    if (errData?.code === "INVALID_TOKEN") {
      console.warn("⚠️ Access token invalid. Refreshing...");
      access_token = await refreshAccessToken(); // You must implement this if not already
      return res
        .status(401)
        .json({ message: "Token refreshed. Please retry." });
    }

    if (
      errData?.code === "RATE_LIMIT_EXCEEDED" ||
      errData?.message?.toLowerCase().includes("rate limit") ||
      errData?.code === "TOO_MANY_REQUESTS"
    ) {
      console.error(`⏳ Rate limit hit. Stopping sync.`);
      return res
        .status(429)
        .json({ error: "Rate limit hit. Try again later." });
    }

    console.error("❌ Unhandled error during sync:", errData || error.message);
    res.status(500).json({
      error: "Failed to sync contacts.",
      details: errData || error.message,
    });
  }
});

// 🌐 Start server
const PORT = process.env.PORT || 3003;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
