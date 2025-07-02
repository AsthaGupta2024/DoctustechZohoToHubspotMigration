const express = require("express");
const axios = require("axios");
const qs = require("qs");
require("dotenv").config();
let currentAccessToken = null;
let refreshToken = null;
let refreshTimeout = null;
let tokenExpiryTime = null;
const app = express();
const hsHelpers = require('./hshelpers.js');
const BASE_URI = process.env.BASE_URI;
const FormData = require("form-data");
const path = require("path");
const fs = require("fs");
const DESTINATION_ACCESS_TOKEN = process.env.DESTINATION_ACCESS_TOKEN;
// const EMAILS_FILE_PATH = path.join(__dirname, 'emails.json');
const EMAILS_LOG_FILE = path.join(__dirname, "zoho-emails.json");
const NOTES_LOG_FILE = "zoho_contact_notes_log.json"; // Local log
const TICKET_LOG_FILE = "zoho_ticket_log.json"; // Local log
app.use(express.json());

//function of access token
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
    console.error("❌ Error fetching Zoho access token:", error.response?.data || error.message);
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

    console.log("✅ Refreshed Zoho access_token. Expires in:", expires_in, "seconds");

    if (refreshTimeout) clearTimeout(refreshTimeout);
    refreshTimeout = setTimeout(refreshAccessToken, (expires_in - 60) * 1000);

    return access_token;
  } catch (error) {
    console.error("❌ Error auto-refreshing access token:", error.response?.data || error.message);
    throw new Error("Access token refresh failed."); // Do not return null
  }
}
app.get("/zoho/contacts", async (req, res) => {
  try {
  // let tokenObj = await getZohoAccessToken();
  // console.log("tokenObj", tokenObj);
  // let access_token = tokenObj.access_token;
  let access_token = '1000.dd6b97f718611dc0f7dfe29228e6f497.7f23f69f69dd9a19db1496f998b353b3';
  console.log("access_token", access_token);
  await fetchAndSyncContactsFromZoho(access_token);
    res.status(200).json({
      message: "Fetched and synced Zoho contacts successfully",
    });
  } catch (error) {
    console.error("Failed to fetch contacts:", error.response?.data || error.message);
    res.status(500).json({
      message: "Error fetching contacts from Zoho",
      error: error.response?.data || error.message,
    });
  }
});
async function syncContactData(datas, access_token) {
  for (const data of datas) {
    // console.log("🔄 Processing contact:", data.Email);

    try {
      if (!data.Email) {
        console.warn("⚠️ Skipping contact because email is missing:", data);
        continue;
      }

      const existingContactId = await hsHelpers.searchContactInHubSpot(data.Email);

      console.log("🔍 Existing HubSpot Contact ID:", existingContactId);

      const contactPayload = {
        properties: {
          firstname: data.First_Name || '',
          lastname: data.Last_Name || '',
          email: data.Email,
          account_approval:data.account_approval,
          ad:data.ad,
          ad_campaign_name:data.ad_campaign_name,
          ad_click_date:data.ad_click_date,
          




        },
      };

      if (existingContactId) {
        // ✅ Update existing contact
        const updateRes = await axios.patch(
          `https://api.hubapi.com/crm/v3/objects/contacts/${existingContactId}`,
          contactPayload,
          {
            headers: {
              Authorization: `Bearer ${DESTINATION_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );
        console.log(`✅ Contact ${data.Email} updated successfully.`);
      } else {
        // ✅ Create new contact
        const createRes = await axios.post(
          "https://api.hubapi.com/crm/v3/objects/contacts",
          contactPayload,
          {
            headers: {
              Authorization: `Bearer ${DESTINATION_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );
        console.log(`✅ Contact ${data.Email} created successfully.`);
      }

      // 👉 You can process related objects below
      // await processNotesForContacts(data, access_token,existingContactId);
      // await processTasksForContacts(data, access_token);
      // await processCallsForContacts(data, access_token);
      // await processMeetingsForContacts(data, access_token);
      // await processEmailsForContacts(data, access_token, existingContactId);


    } catch (err) {
      console.error(`❌ Error processing contact: ${data.Email || "unknown"}`);
      if (err.response) {
        console.error("Status:", err.response.status);
        console.error("Details:", JSON.stringify(err.response.data, null, 2));
      } else {
        console.error("Error:", err.message);
      }
      continue; // move to next contact
    }
  }
}

async function fetchAndSyncContactsFromZoho(access_token) {
  let page = 1;
  let moreRecords = true;
  console.log("access_token", access_token);
  if (!access_token) {
    throw new Error("Access token not available.");
  }

  do {
  //  const url = `https://www.zohoapis.com/crm/v2/Contacts?page=${page}&per_page=5`;
      const url = 'https://www.zohoapis.com/crm/v2/Contacts/4582160000170022041'
    try {
      console.log(`Fetching Contacts - Page: ${page}`);
      console.log("access_token", access_token);
      const response = await axios.get(url, {
        headers: {
          Authorization: `Zoho-oauthtoken ${access_token}`,
        },
      });
      // console.log("response", response.data);
      const { data, info } = response.data;
      console.log(`Fetched ${data.length} contacts from page ${page}`);

      await syncContactData(data, access_token);

      moreRecords = info?.more_records || false;
      page += 1;

      const remaining = response.headers['x-ratelimit-remaining'];
      if (remaining && parseInt(remaining) <= 1) {
        console.warn(`⛔ Rate limit almost reached on page ${page}. Stopping further requests.`);
        break;
      }

    } catch (error) {
      const errData = error.response?.data;

      if (errData?.code === "INVALID_TOKEN") {
        console.warn("⚠️ Access token invalid. Refreshing and retrying...");
        access_token = await refreshAccessToken();
        continue;
      }

      if (
        errData?.code === "RATE_LIMIT_EXCEEDED" ||
        errData?.message?.toLowerCase().includes("rate limit")
      ) {
        console.error(`Rate limit hit on page ${page}. Stopping.`);
        break;
      }

      if (errData?.code === 'TOO_MANY_REQUESTS') {
        console.error(`HubSpot rate limit hit while syncing. Stopping.`);
        break;
      }

      console.error("Unhandled error fetching contacts:", errData || error.message);
      throw error;
    }

  } while (moreRecords);
}

// async function fetchAndSyncContactsFromZoho() {
//   let page = 100;
//   let moreRecords = true;

//   let tokenObj = await getZohoAccessToken();
//   let access_token = tokenObj.access_token;
//   console.log("access_token", access_token);
//   // let access_token = '1000.2cdad119e64bd38fcbe7979e95c0eab3.642fbcbbd37e156b33cefd0d15b57f06'
//   if (!access_token) {
//     throw new Error("Access token not available.");
//   }

//   do {
//     const url = `https://www.zohoapis.com/crm/v2/Contacts?page=${page}&per_page=5`;
//     // const contactId = "540502000027206114"; // test ID
//     // const url = `https://www.zohoapis.in/crm/v2/Contacts/${contactId}`;

//     try {
//       console.log("Fetching Contacts - Page:", page);
//       console.log("ac", access_token);
//       const response = await axios.get(url, {
//         headers: {
//           Authorization: `Zoho-oauthtoken ${access_token}`,
//         }
//       });
//       // console.log("response", response.data);
//       const { data, info } = response.data;
//       // console.log(`Fetched ${data.length} contacts from page ${page}`);

//       // 👉 Sync immediately
//       await syncContactData(data, access_token);

//       moreRecords = info?.more_records || false;
//       page += 1;



//     } catch (error) {
//       const errData = error.response?.data;
//       console.log("Error Response:", errData)
//       // console.error("Unhandled error fetching contacts:", errData || error.message);
//       throw error;
//     }

// } 
//   while (moreRecords);
// }

async function processNotesForContacts(data, SOURCE_ACCESS_TOKEN,existingOpportunityId) {
   const email = data.Email;
   const notes = await fetchNotesWithAttachmentsFromZohoContacts(data.id, SOURCE_ACCESS_TOKEN,existingOpportunityId);
  // await syncNotesWithHubSpot(email, notes);
}
// async function fetchNotesFromZoho(contactId, SOURCE_ACCESS_TOKEN) {
//   try {
//     const url = `https://www.zohoapis.com/crm/v2/Contacts/${contactId}/Notes`;

//     const response = await axios.get(url, {
//       headers: {
//         Authorization: `Zoho-oauthtoken ${SOURCE_ACCESS_TOKEN}`
//       },
//     });

//     const allNotes = response.data.data;

//     if (!allNotes || allNotes.length === 0) {
//       console.log("No notes found for this Zoho contact.");
//       return [];
//     }

//     // ✅ Filter: Only include notes where $se_module is 'Contacts'
//     const notes = allNotes.filter(note => note.$se_module === 'Deals');

//     // Optional: Log skipped notes
//     allNotes
//       .filter(note => note.$se_module !== 'Contacts')
//       .forEach(note => {
//         console.log(`⏭️ Skipped note ${note.id} - Module: ${note.$se_module}`);
//       });

//     const crmTagRegex = /crm\[user#\d+#\d+\]crm/g;

//     const formattedNotes = notes.map((note) => ({
//       id: note.id,
//       title: note.Note_Title || "No title",
//       content: (note.Note_Content || "No content").replace(crmTagRegex, '').trim(),
//       createdTime: note.Created_Time || null,
//     }));

//     return formattedNotes;
//   } catch (error) {
//     console.error(
//       `❌ Error fetching notes for Zoho contact ${contactId}:`,
//       error.response ? error.response.data : error.message
//     );
//     return [];
//   }
// }
// async function syncNotesWithHubSpot(email, notes) {
//   // console.log("email", email);
//   const hubSpotContactId = await  hsHelpers.getHubSpotContactIdByEmail(
//     email,
//     DESTINATION_ACCESS_TOKEN
//   );

//   if (!hubSpotContactId) {
//     console.error(`No HubSpot contact found for email: ${email}`);
//     return;
//   }
//   // console.log("hubSpotContactId", hubSpotContactId);

//   for (const note of notes) {
//     // console.log("Processing note:", note);

//     try {
//       // Convert `timestamp` to milliseconds
//       const timestamp = note.createdTime
//         ? new Date(note.createdTime).getTime()
//         : new Date().getTime(); // Use current time if no timestamp

//       const response = await axios.post(
//         "https://api.hubapi.com/engagements/v1/engagements",
//         {
//           engagement: {
//             active: true,
//             type: "NOTE",
//             timestamp, // Send timestamp in milliseconds
//           },
//           associations: {
//             contactIds: [hubSpotContactId],
//           },
//           metadata: {
//             body: note.content,
//           },
//         },
//         {
//           headers: {
//             Authorization: `Bearer ${DESTINATION_ACCESS_TOKEN}`,
//             "Content-Type": "application/json",
//           },
//         }
//       );
//       console.log(
//         `Note for Contact ${hubSpotContactId} synced successfully:`
//       );
//     } catch (error) {
//       console.error(
//         `Error syncing note for Contact ${hubSpotContactId}:`,
//         error.response ? error.response.data : error.message
//       );
//     }
//   }
// }
async function fetchNotesWithAttachmentsFromZohoContacts(contactId, zohoAccessToken, existingOpportunityId) {
  console.log("📌 Fetching notes for contactId:", contactId);
  const allNotes = [];
  const notesUrl = `https://www.zohoapis.com/crm/v2/Contacts/${contactId}/Notes`;

  try {
    const response = await axios.get(notesUrl, {
      headers: {
        Authorization: `Zoho-oauthtoken ${zohoAccessToken}`,
        "Content-Type": "application/json",
      },
    });

    const allNotes = response.data.data || [];
    if (allNotes.length === 0) {
      console.log("❌ No notes found for contact ID:", contactId);
      return allNotes;
    }
   //     // ✅ Filter: Only include notes where $se_module is 'Contacts'
    const notes = allNotes.filter(note => note.$se_module === 'Deals');

    // Optional: Log skipped notes
    allNotes
      .filter(note => note.$se_module !== 'Contacts')
      .forEach(note => {
        console.log(`⏭️ Skipped note ${note.id} - Module: ${note.$se_module}`);
      });


    for (const note of notes) {
      const noteId = note.id;
      console.log("📝 Processing note ID:", noteId);
      // ✅ Format note
      const formattedNote = {
        noteId: noteId,
        title: note.Note_Title || "",
        content: note.Note_Content || "",
        createdTime: note.Created_Time || "",
        createdBy: note.Created_By?.name || "",
        hasAttachment: false,
        attachments: [],
        contactId: contactId,
      };

      // ✅ Log and save locally
      let existingData = {};
      if (fs.existsSync(NOTES_LOG_FILE)) {
        const fileContent = fs.readFileSync(NOTES_LOG_FILE);
        existingData = JSON.parse(fileContent || "{}");
      }
      if (!existingData[contactId]) {
        existingData[contactId] = [];
      }
      existingData[contactId].push(formattedNote);
      fs.writeFileSync(NOTES_LOG_FILE, JSON.stringify(existingData, null, 2));

      // ✅ Try to fetch attachments for the note (if any)
      const attachmentsUrl = `https://www.zohoapis.com/crm/v2/Notes/${noteId}/Attachments`;
      try {
        const attachmentResponse = await axios.get(attachmentsUrl, {
          headers: {
            Authorization: `Zoho-oauthtoken ${zohoAccessToken}`,
            "Content-Type": "application/json",
          },
        });

        const attachments = attachmentResponse.data.data || [];
        console.log("attachments", attachments);
        if (attachments.length > 0) {
          formattedNote.hasAttachment = true;
          formattedNote.attachments = attachments;

          for (const attachment of attachments) {
            console.log("attachment", attachment);
            const fileDetail = await downloadZohoEmailAttachment({
              contactId,
              noteId,
              userId: "3652397000000186017",
              attachment,
              zohoAccessToken,
            });

            // const uploadFileId = fileDetail?.id;
            // await createEngagementWithAttachment(
            //   formattedNote,
            //   existingOpportunityId,
            //   uploadFileId,
            //   DESTINATION_ACCESS_TOKEN
            // );
          }
        }
        else{
          // ✅ No attachments: create a simple note in HubSpot
          await createNoteInHubSpot(existingOpportunityId, formattedNote.content);
          console.log("✅ Note created in HubSpot without attachment.");

        }
      } catch (attachmentError) {
        console.warn(`⚠️ Could not fetch attachments for note ID: ${noteId}`);
      }

      console.log("📝 Note fetched:", formattedNote.title || formattedNote.content.slice(0, 30));
      allNotes.push(formattedNote);
    }
  } catch (error) {
    console.error(
      `❌ Error fetching notes for contact ID ${contactId}:`,
      error.response?.data || error.message
    );
  }

  return allNotes;
}
async function processTasksForContacts(data, SOURCE_ACCESS_TOKEN) {
  console.log("data------------------------>", data);
  // console.log("SOURCE_ACCESS_TOKEN", SOURCE_ACCESS_TOKEN);
  const email = data.Email;
  // console.log("email-------->", email);
  const tasks = await fetchTasksFromZoho(data.id, SOURCE_ACCESS_TOKEN);
  // Sync only the current note with HubSpot or perform further processing
  await syncTasksWithHubSpot(email, tasks);
}
async function fetchTasksFromZoho(contactId, SOURCE_ACCESS_TOKEN) {
  try {
    const url = `https://www.zohoapis.com/crm/v2/Contacts/${contactId}/Tasks`;

    const response = await axios.get(url, {
      headers: {
        Authorization: `Zoho-oauthtoken ${SOURCE_ACCESS_TOKEN}`
      },
    });
    console.log("response", response.data);
    const associatedTasks = response.data.data;

    if (!associatedTasks || associatedTasks.length === 0) {
      console.log("No tasks associated with this contact.");
      return [];
    }

    // ✅ Filter: Only include tasks where $se_module is 'Contacts'
    const filteredTaskAssociations = associatedTasks.filter(task => task.$se_module === 'Contacts');

    // Optional: Log skipped tasks
    associatedTasks
      .filter(task => task.$se_module !== 'Contacts')
      .forEach(task => {
        console.log(`⏭️ Skipped task ${task.id} - Module: ${task.$se_module}`);
      });

    // Step 2: Fetch detailed task properties
    const tasks = await Promise.all(
      filteredTaskAssociations.map(async (taskAssociation) => {
        const taskId = taskAssociation.id;

        const taskDetailsUrl = `https://www.zohoapis.com/crm/v2/Tasks/${taskId}`;

        try {
          const taskDetailsResponse = await axios.get(taskDetailsUrl, {
            headers: {
              Authorization: `Zoho-oauthtoken ${SOURCE_ACCESS_TOKEN}`
            },
          });
          console.log("taskDetailsResponse", taskDetailsResponse.data);
          const taskData = taskDetailsResponse.data.data[0]; // Zoho returns an array in `data`
          console.log("taskData", taskData);
          return {
            id: taskData.id,
            timestamp: taskData.Modified_Time || null,
            status: taskData.Status || "UNKNOWN",
            priority: taskData.Priority || "NONE",
            body: taskData.Description || "No body content",
            subject: taskData.Subject || "No subject"

          };
        } catch (error) {
          console.error(`Error fetching details for task ID ${taskId}:`, error.message);
          return null; // Skip this task if there's an error
        }
      })
    );

    const filteredTasks = tasks.filter((task) => task !== null); // Remove any null values

    return filteredTasks;
  } catch (error) {
    console.error(
      `Error fetching tasks for Zoho contact ${contactId}:`,
      error.response ? error.response.data : error.message
    );
    return [];
  }
}
async function syncTasksWithHubSpot(email, tasks) {
  // console.log("email", email);

  const hubSpotContactId = await hsHelpers.getHubSpotContactIdByEmail(
    email,
    DESTINATION_ACCESS_TOKEN
  );

  if (!hubSpotContactId) {
    console.error(`No HubSpot contact found for email: ${email}`);
    return;
  }

  // console.log("hubSpotContactId", hubSpotContactId);

  for (const task of tasks) {
    // console.log("Processing task:", task);

    try {
      const timestamp = task.timestamp
        ? new Date(task.timestamp).getTime()
        : new Date().getTime(); // Fallback to current time

      const response = await axios.post(
        "https://api.hubapi.com/engagements/v1/engagements",
        {
          engagement: {
            active: true,
            type: "TASK",
            timestamp,
          },
          associations: {
            contactIds: [hubSpotContactId],
          },
          metadata: {
            subject: task.subject,
            body: task.body,
            status:
              task.status === "Not Started"
                ? "NOT_STARTED"
                : task.status === "In Progress"
                  ? "IN_PROGRESS"
                  : task.status === "Waiting"
                    ? "WAITING"
                    : task.status === "Deferred"
                      ? "DEFERRED"
                      : task.status === "Completed"
                        ? "COMPLETED"
                        : "NOT_STARTED",
            priority:
              task.priority === "High"
                ? "HIGH"
                : task.priority === "Medium"
                  ? "MEDIUM"
                  : task.priority === "Low"
                    ? "LOW"
                    : "NONE",
          },
        },
        {
          headers: {
            Authorization: `Bearer ${DESTINATION_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log(
        `Task for Contact ${hubSpotContactId} synced successfully:`
      );
    } catch (error) {
      console.error(
        `Error syncing task for Contact ${hubSpotContactId}:`,
        error.response ? error.response.data : error.message
      );
    }
  }
}

async function processCallsForContacts(data, SOURCE_ACCESS_TOKEN) {
  // console.log("data------------------------>", data);
  const email = data.Email;
  const calls = await fetchCallsFromZohoContact(data.id, SOURCE_ACCESS_TOKEN);
  await syncCallsWithHubSpot(email, calls);
}

async function fetchCallsFromZohoContact(contactId, SOURCE_ACCESS_TOKEN) {
  // console.log("📞 Fetching calls for Zoho contact ID:", contactId);
  console.log("contactId", contactId);
  try {
    const url = `https://www.zohoapis.com/crm/v2/Contacts/${contactId}/Calls`;

    const response = await axios.get(url, {
      headers: {
        Authorization: `Zoho-oauthtoken ${SOURCE_ACCESS_TOKEN}`,
      },
    });
    console.log("response", response.data);
    const calls = response.data?.data || [];
    console.log(`callssssssssssssssssssssssssssssssssss`, calls);
    if (calls.length === 0) {
      console.log("No calls found for this contact.");
      return [];
    }

    // ✅ Optional: Log skipped calls where $se_module is not "Contacts"
    calls
      .filter(call => call.$se_module !== 'Contacts')
      .forEach(call => {
        console.log(`⏭️ Skipped call ${call.id} - Module: ${call.$se_module}`);
      });

    // // ✅ Filter: Only include calls where $se_module is 'Contacts'
    const filteredCalls = calls.filter(call => call.$se_module === 'Contacts');

    const formattedCalls = filteredCalls.map((call) => {
      return {
        id: call.id,
        subject: call.Subject || "No subject",
        callType: call.Call_Type || "Not Specified",
        callStartTime: call.Call_Start_Time || null,
        callDuration: call.Call_Duration || "N/A",
        callPurpose: call.Call_Purpose || "N/A",
        callResult: call.Call_Result || "N/A",
        description: call.Description || "No description",
        createdBy: call.Created_By?.name || "Unknown",
        createdTime: call.Created_Time || null,
      };
    });

    console.log(`✅ Fetched ${formattedCalls.length} call(s) from Zoho for contact ${contactId}`);
    console.log("Formatted Calls:", formattedCalls);

    return formattedCalls;
  } catch (error) {
    console.error(
      `❌ Error fetching calls for Zoho contact ${contactId}:`,
      error.response?.data || error.message
    );
    return [];
  }
}

async function syncCallsWithHubSpot(email, calls) {
  // console.log("email",email);
  // console.log("calls",calls);
  const hubSpotContactId = await hsHelpers.getHubSpotContactIdByEmail(email, DESTINATION_ACCESS_TOKEN);
  // console.log("hubSpotContactId", hubSpotContactId);
  if (!hubSpotContactId) {
    console.error(`No HubSpot contact found for email: ${email}`);
    return;
  }
  for (const call of calls) {
    // console.log("Processing call:", call);
    try {
      const timestamp = call.createdTime
        ? new Date(call.createdTime).getTime()
        : new Date().getTime(); // Use current time if no timestamp

      const response = await axios.post(
        "https://api.hubapi.com/engagements/v1/engagements",
        {
          engagement: {
            active: true, // Assuming the call is active (can adjust based on your logic)
            type: "CALL",
            timestamp, // Send timestamp in milliseconds
          },
          associations: {
            contactIds: [hubSpotContactId],
          },
          metadata: {
            subject: call.subject,
            callType: call.callType,
            callStartTime: call.callStartTime,
            callDuration: call.callDuration,
            callPurpose: call.callPurpose,
            callResult: call.callResult,
            description: call.description,
            createdBy: call.createdBy
          },
        },
        {
          headers: {
            Authorization: `Bearer ${DESTINATION_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );
      console.log(
        `Call activity for Contact ${hubSpotContactId} synced successfully:`

      );
    } catch (error) {
      console.error(
        `Error syncing call activity for Contact ${hubSpotContactId}:`,
        error.response ? error.response.data : error.message
      );
    }
  }
}

async function processMeetingsForContacts(data, SOURCE_ACCESS_TOKEN) {
  const email = data.Email;
  // console.log("email-------->", email);
  const meetings = await fetchMeetingsFromZoho(data.id, SOURCE_ACCESS_TOKEN);
  // Sync only the current note with HubSpot or perform further processing
  await syncMeetingsWithHubSpot(email, meetings);
}
async function fetchMeetingsFromZoho(contactId, SOURCE_ACCESS_TOKEN) {
  // console.log("Fetching emails for Zoho contact ID:", contactId);
  // console.log("SOURCE_ACCESS_TOKEN2", SOURCE_ACCESS_TOKEN);
  try {
    const url = `https://www.zohoapis.in/crm/v2/Contacts/${contactId}/Events`;
    // const url = `https://www.zohoapis.in/crm/v2/Contacts/540502000024788017/Events`;
    const response = await axios.get(url, {
      headers: {
        Authorization: `Zoho-oauthtoken ${SOURCE_ACCESS_TOKEN}`
      },
    });

    const emails = response.data;
    // console.log("emails", emails);

    if (!emails || !emails.data || emails.data.length === 0) {
      console.log("No emails found for this Zoho contact.");
      return [];
    }

    // Use emails.data instead of emails
    const formattedEmails = emails.data.map((email) => ({
      id: email.id,
      subject: email.Event_Title,
      body: email.Description,
      createdTime: email.Created_Time || null,
      from: email.Created_By?.name,
      to: email.Participants?.map(p => p.name).join(", "),
    }));

    // console.log(`✅ Fetched ${formattedEmails.length} emails from Zoho for contact ${contactId}`);
    // console.log("formattedEmails", formattedEmails);
    return formattedEmails;
  } catch (error) {
    console.error(
      `❌ Error fetching emails for Zoho contact ${contactId}:`,
      error.response ? error.response.data : error.message
    );
    return [];
  }
}
async function syncMeetingsWithHubSpot(email, meetings) {
  const hubSpotContactId = await hsHelpers.getHubSpotContactIdByEmail(email, DESTINATION_ACCESS_TOKEN);
  if (!hubSpotContactId) {
    console.error(`❌ No HubSpot contact found for email: ${email}`);
    return;
  }

  for (const meeting of meetings) {
    try {
      const timestamp = meeting.createdTime
        ? new Date(meeting.createdTime).getTime()
        : new Date().getTime();

      await axios.post(
        "https://api.hubapi.com/engagements/v1/engagements",
        {
          engagement: {
            active: true,
            type: "MEETING",
            timestamp,
          },
          associations: {
            contactIds: [hubSpotContactId],
          },
          metadata: {
            body: meeting.description,
            startTime: meeting.startTime ? new Date(meeting.startTime).getTime() : timestamp,
            endTime: meeting.endTime ? new Date(meeting.endTime).getTime() : timestamp + 3600000, // default 1 hour
            title: meeting.subject,
            location: meeting.location,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${DESTINATION_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log(`✅ Meeting synced for HubSpot contact ID ${hubSpotContactId}`);
    } catch (error) {
      console.error(
        `❌ Error syncing meeting for HubSpot contact ${hubSpotContactId}:`,
        error.response?.data || error.message
      );
    }
  }
}

//function to fetch company(account)
async function processEmailsForContacts(data, SOURCE_ACCESS_TOKEN, existingOpportunityId) {
  const email = data.Email;
  const emails = await fetchEmailsWithAttachmentsFromZohoContacts(data.id, SOURCE_ACCESS_TOKEN, existingOpportunityId);
  // Sync only the current note with HubSpot or perform further processing
  await syncCallsWithHubSpot(email, emails);
}
// async function fetchEmailsWithAttachmentsFromZohoContacts(contactId, zohoAccessToken, existingOpportunityId) {
//   const allEmails = [];

//   // console.log(`Fetching emails for Zoho contact ID: ${contactId}`);

//   const emailListUrl = `https://www.zohoapis.com/crm/v2/Contacts/${contactId}/Emails`;
//   // const emailListUrl = `https://www.zohoapis.in/crm/v2/Contacts/540502000042169041/Emails`;
//   try {
//     const response = await axios.get(emailListUrl, {
//       headers: {
//         Authorization: `Zoho-oauthtoken ${zohoAccessToken}`,
//         "Content-Type": "application/json",
//       },
//     });
//     console.log("eresponse", response.data); // Log the response

//     const emailList = response.data.email_related_list;
//     console.log("emailList", emailList);
    
//     // if (!emailList || emailList.length === 0) {
//     //   console.log(`No emails found for contact ID: ${contactId}`);
//     //   return allEmails;
//     // }

//     if (!emailList || emailList.length === 0) {
//       console.log("No emails found for contact ID:", contactId);
//       // Store the data in a file
     
//       console.log(`Data written to file: ${dataFileName}`);
//       console.log(`No emails found for contact ID: ${contactId}`);
//       return allEmails;
//     }




//     for (const email of emailList) {

//       const messageId = email.message_id;
//       console.log("messageId", messageId)
//       const dataFileName = `zoho-contacts-${contactId}-emails.json`;
//       fs.writeFileSync(dataFileName, JSON.stringify(messageId, null, 2));
//       if (!messageId) {
//         console.log("No message ID found for email, skipping...");
//         continue;
//       }

//       const emailDetailsUrl = `https://www.zohoapis.com/crm/v4/Contacts/${contactId}/Emails/${messageId}`;
//       // const emailDetailsUrl = `https://www.zohoapis.in/crm/v4/Contacts/540502000042169041/Emails/${messageId}`;
//       try {
//         const detailResponse = await axios.get(emailDetailsUrl, {
//           headers: {
//             Authorization: `Zoho-oauthtoken ${zohoAccessToken}`,
//             "Content-Type": "application/json",
//           },
//         });
//         //  console.log("detailResponse", detailResponse.data);
//         const emailDetails = detailResponse.data.Emails[0]; // ✅ fixed key
//         // console.log("emailDetails", emailDetails);

//         const formattedEmail = {
//           subject: emailDetails.subject || "No Subject",
//           from: emailDetails.from?.email || "",
//           to: emailDetails.to?.map((r) => r.email) || [],
//           sentDateTime: emailDetails.sent_time,
//           content: emailDetails?.content || "", // HTML content
//           messageId: messageId,
//           hasAttachment: emailDetails.attachments?.length > 0,
//           attachments: emailDetails.attachments,
//           contactId: contactId,
//         };
//         // console.log("formattedEmail", formattedEmail);

//         if (formattedEmail.hasAttachment) {
//           for (const attachment of emailDetails.attachments) {
//             const fileDetail = await downloadZohoEmailAttachment({
//               contactId,
//               messageId,
//               userId: "3652397000000186017",
//               attachment,
//               zohoAccessToken,
//             });
//             console.log("fileDetail", fileDetail);
//             const uploadFileId = fileDetail.id;
//             // console.log("fileId", fileDetail.id);
//             // console.log("fileName", fileDetail.name);
//             // if (filePath) {
//             //   formattedEmail.attachments.push({
//             //     name: attachment.name,
//             //     id: filePath,
//             //   });
//             // }
//             await createEngagementWithAttachment(
//               formattedEmail,
//               existingOpportunityId,
//               uploadFileId,
//               DESTINATION_ACCESS_TOKEN
//             );
//           }
//         }

//         // console.log("✅ Email fetched with message ID:", messageId);
//         allEmails.push(formattedEmail);
//       } catch (error) {
//         console.error(
//           `❌ Error fetching email detail for message ID ${messageId}:`,
//           error.response?.data || error.message
//         );
//       }

//     }
//   } catch (error) {
//     console.error(
//       `❌ Error fetching email list for contact ID ${contactId}:`,
//       error.response?.data || error.message
//     );
//   }

//   return allEmails;
// }

async function fetchEmailsWithAttachmentsFromZohoContacts(contactId, zohoAccessToken, existingOpportunityId) {
  console.log("contactId", contactId);
  const allEmails = [];
  const emailListUrl = `https://www.zohoapis.com/crm/v2/Contacts/${contactId}/Emails`;

  try {
    const response = await axios.get(emailListUrl, {
      headers: {
        Authorization: `Zoho-oauthtoken ${zohoAccessToken}`,
        "Content-Type": "application/json",
      },
    });

    const emailList = response.data.email_related_list;
    if (!emailList || emailList.length === 0) {
      console.log("❌ No emails found for contact ID:", contactId);
      return allEmails;
    }

    for (const email of emailList) {
      const messageId = email.message_id;
      if (!messageId) {
        console.log("⚠️ No message ID found for email, skipping...");
        continue;
      }

      const emailDetailsUrl = `https://www.zohoapis.com/crm/v4/Contacts/${contactId}/Emails/${messageId}`;
      try {
        const detailResponse = await axios.get(emailDetailsUrl, {
          headers: {
            Authorization: `Zoho-oauthtoken ${zohoAccessToken}`,
            "Content-Type": "application/json",
          },
        });

        const emailDetails = detailResponse.data.Emails[0];

        // ✅ Log email details
        console.log(`📧 Email details for contact ID ${contactId}:`, JSON.stringify(emailDetails, null, 2));

        // ✅ Store email details to file
        let existingData = {};
        if (fs.existsSync(EMAILS_LOG_FILE)) {
          const fileContent = fs.readFileSync(EMAILS_LOG_FILE);
          existingData = JSON.parse(fileContent || "{}");
        }

        if (!existingData[contactId]) {
          existingData[contactId] = [];
        }

        existingData[contactId].push(emailDetails);

        fs.appendFileSync(EMAILS_LOG_FILE, `${contactId}\n`);
        fs.writeFileSync(EMAILS_LOG_FILE, JSON.stringify(existingData, null, 2));

        const formattedEmail = {
          subject: emailDetails.subject || "No Subject",
          from: emailDetails.from?.email || "",
          to: emailDetails.to?.map((r) => r.email) || [],
          sentDateTime: emailDetails.sent_time,
          content: emailDetails?.content || "",
          messageId: messageId,
          hasAttachment: emailDetails.attachments?.length > 0,
          attachments: emailDetails.attachments,
          contactId: contactId,
        };
        console.log("formattedEmail", formattedEmail);
        if (formattedEmail.hasAttachment) {
          for (const attachment of emailDetails.attachments) {
            const fileDetail = await downloadZohoEmailAttachment({
              contactId,
              messageId,
              userId: "3652397000000186017",
              attachment,
              zohoAccessToken,
            });

            const uploadFileId = fileDetail.id;
            await createEngagementWithAttachment(
              formattedEmail,
              existingOpportunityId,
              uploadFileId,
              DESTINATION_ACCESS_TOKEN
            );
          }
        }

        allEmails.push(formattedEmail);
      } catch (error) {
        console.error(
          `❌ Error fetching email detail for message ID ${messageId}:`,
          error.response?.data || error.message
        );
      }
    }

  } catch (error) {
    console.error(
      `❌ Error fetching email list for contact ID ${contactId}:`,
      error.response?.data || error.message
    );
  }

  return allEmails;
}

async function downloadZohoEmailAttachment({ contactId, messageId, userId, attachment, zohoAccessToken }) {
  // const { id, name } = attachment;
  console.log('contactId', contactId);
  console.log('messageId', messageId);
  console.log('userId', userId);
  const id1 = attachment.id;
  const name = attachment.name;
  console.log("id1", id1);
  console.log("name", name);
  console.log("zohoAccessToken", zohoAccessToken);
  const downloadUrl = `https://www.zohoapis.com/crm/v4/Contacts/${contactId}/Emails/actions/download_attachments`;
  const params = {
    message_id: messageId,
    user_id: userId,
    id: id1,
    name: name,
  };

  try {
    console.log(`🔗 Download URL: ${downloadUrl}`);
    console.log(`📝 Params:`, params);

    const response = await axios.get(downloadUrl, {
      headers: {
        Authorization: `Zoho-oauthtoken ${zohoAccessToken}`,
      },
      params,
      responseType: "arraybuffer",
    });

    // console.log(`📥 Downloading attachment "${name}"...`);
    // console.log("📊 Response status:", response.status);
    const fileBuffer = Buffer.from(response.data);
    console.log("fileBuffer", fileBuffer);
    
    // Upload to HubSpot
    const fileId = await uploadFileToHubSpot(fileBuffer, name, DESTINATION_ACCESS_TOKEN);
    // const fileId = await uploadFileToHubSpot(fileBuffer, name, DESTINATION_ACCESS_TOKEN);

    return {
      name: name,
      id: fileId,
    };


  } catch (error) {
    console.error(`❌ Failed to download attachment "${name}"`, error.response?.data || error.message);
    return null;
  }
}
async function uploadFileToHubSpot(fileBuffer, fileName, accessToken) {
  try {
    console.log('📁 Preparing to upload file to HubSpot...');

    // Set default file name if not provided
    if (!fileName) {
      const timestamp = Date.now();
      fileName = `upload_${timestamp}.txt`;
    } else if (!fileName.includes('.')) {
      // Ensure file has an extension
      fileName += '.txt';
    }

    console.log('📦 File Name:', fileName);
    console.log('🔐 Using Access Token:', accessToken.slice(0, 10) + '...');

    const form = new FormData();
    form.append('file', fileBuffer, {
      filename: fileName,
      contentType: 'application/octet-stream',
    });

    // ✅ Add required folderPath (or use folderId instead)
    form.append('folderPath', 'uploads');
    form.append('options', JSON.stringify({ access: 'PRIVATE' }));

    console.log('📝 Form prepared, sending POST request to HubSpot...');

    const uploadUrl = 'https://api.hubapi.com/files/v3/files';
    const response = await axios.post(uploadUrl, form, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...form.getHeaders(),
      },
    });

    console.log('✅ Uploaded file to HubSpot successfully!');
    console.log('📎 File Info:', response.data);

    return response.data;

  } catch (error) {
    console.error('❌ Error uploading file to HubSpot:');
    console.error(error.response?.data || error.message);
    throw error;
  }
}
async function createEngagementWithAttachment(
  formattedEmail,
  hubSpotContactId,
  uploadedFileId,
  accessToken
) {
  try {
    console.log("uploadedFileId:", uploadedFileId);
    console.log("email:", formattedEmail);
    console.log("hubSpotContactId:", hubSpotContactId);
    console.log("accessToken:", accessToken);

    // Corrected timestamp line
    const timestamp = formattedEmail.sentDateTime
      ? new Date(formattedEmail.sentDateTime).getTime()
      : Date.now();

    const emailBody = formattedEmail.content
      ? formattedEmail.content
      : "No body content";

    const engagementData = {
      engagement: {
        active: true,
        type: "EMAIL",
        timestamp: timestamp,
      },
      associations: {
        contactIds: [hubSpotContactId],
      },
      attachments: uploadedFileId.id
        ? [{ id: uploadedFileId.id}]
        : [],

      metadata: {
        html: emailBody,
        subject: formattedEmail.subject || "No subject content",
        from: {
          email: formattedEmail.from || "",
        },
        to: formattedEmail.to?.map(email => ({ email })) || [],
      },
    };

    // console.log(
    //   "Engagement data being sent:",
    //   JSON.stringify(engagementData, null, 2)
    // );

    const engagementResponse = await axios.post(
      "https://api.hubapi.com/engagements/v1/engagements",
      engagementData,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(
      `✅ Email synced successfully with HubSpot for contact ID ${hubSpotContactId}.`
    );
  } catch (error) {
    console.error(
      `❌ Error syncing email for contact ID ${hubSpotContactId}:`,
      error.response ? error.response.data : error.message
    );
  }
}
async function createNoteInHubSpot(objectId, noteContent) {
  console.log("📝 Note content:", noteContent);
  console.log("📝 Object ID:", objectId);
  const HUBSPOT_NOTES_URL = "https://api.hubapi.com/engagements/v1/engagements";
  
  const payload = {
    engagement: {
      active: true,
      type: "NOTE",
    },
    associations: {
      contactIds: [objectId], // assuming you're associating with a deal
    },
    metadata: {
      body: noteContent,
    },
  };

  try {
    const response = await axios.post(HUBSPOT_NOTES_URL, payload, {
      headers: {
        Authorization: `Bearer ${DESTINATION_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    console.log("📝 Note created in HubSpot:", response.data);
  } catch (err) {
    console.error("❌ Error creating note in HubSpot:", err.response?.data || err.message);
  }
}

async function  processTicketsForContacts(data, SOURCE_ACCESS_TOKEN) {
   const email = data.Email;
  // console.log("email-------->", email);
  const tickets=await fetchTicketsFromZohoDesk(SOURCE_ACCESS_TOKEN);
  // Sync only the current note with HubSpot or perform further processing
  // await syncTicketsWithHubSpot(email, meetings);
}

app.get("/zoho/tickets", async (req, res) => {
  try {
  // let tokenObj = await getZohoAccessToken();
  // console.log("tokenObj", tokenObj);
  // let access_token = tokenObj.access_token;
  let access_token = '1000.dd6b97f718611dc0f7dfe29228e6f497.7f23f69f69dd9a19db1496f998b353b3';
  console.log("access_token", access_token);
  await fetchTicketsFromZohoDesk(access_token);
    res.status(200).json({
      message: "Fetched and synced Zoho contacts successfully",
    });
  } catch (error) {
    console.error("Failed to fetch contacts:", error.response?.data || error.message);
    res.status(500).json({
      message: "Error fetching contacts from Zoho",
      error: error.response?.data || error.message,
    });
  }
});

async function fetchTicketsFromZohoDesk(accessToken) {
  console.log("🎟️ Fetching tickets from Zoho Desk...");

  const url = `https://desk.zoho.com/api/v1/tickets?limit=10`;

  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
      },
    });

    const { data: tickets, info } = response.data;
    console.log("📦 Raw tickets response:", tickets);
    console.log(`📄 Pagination Info:`, info);

    fs.writeFileSync(TICKET_LOG_FILE, JSON.stringify(tickets, null, 2));

    if (!tickets || tickets.length === 0) {
      console.log("📭 No tickets found.");
      return [];
    }

    const formattedTickets = tickets.map(ticket => ({
      id: ticket.id,
      subject: ticket.subject || "No Subject",
      departmentId: ticket.departmentId,
      contactId: ticket.contactId,
      status: ticket.status,
      priority: ticket.priority,
      createdTime: ticket.createdTime,
      dueDate: ticket.dueDate,
      channel: ticket.channel,
    }));

    console.log(`✅ Fetched ${formattedTickets.length} tickets from Zoho Desk.`);

    // Now sync the tickets to destination system
    await syncticketData(formattedTickets, accessToken);

    return formattedTickets;

  } catch (error) {
    console.error(
      `❌ Error fetching tickets from Zoho Desk:`,
      error.response ? error.response.data : error.message
    );
    return [];
  }
}
async function syncticketData(tickets, accessToken) {
  try {
    console.log("🔄 Syncing tickets to HubSpot...");

    for (const ticket of tickets) {
      console.log(`🔗 Syncing ticket ID ${ticket.id} - "${ticket.subject}"`);

      const payload = {
        properties: {
          subject: ticket.subject || "No Subject",
          hs_ticket_priority: mapPriority(ticket.priority),
          hs_pipeline: "0", // Default pipeline ID
          hs_pipeline_stage: "1", // Default stage ID (New)
          createdate: ticket.createdTime,
          content: `Created via Zoho Desk\nStatus: ${ticket.status}\nChannel: ${ticket.channel}`,
        },
        // Optional: If you want to associate with contact/company/deal, add here
        associations: ticket.contactId ? [
          {
            to: { id: ticket.contactId }, // Must be HubSpot contact ID
            types: [
              {
                associationCategory: "HUBSPOT_DEFINED",
                associationTypeId: 3 // Contact-to-ticket
              }
            ]
          }
        ] : []
      };

      const response = await axios.post(
        'https://api.hubapi.com/crm/v3/objects/tickets',
        payload,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      console.log(`✅ Ticket synced to HubSpot with ID: ${response.data.id}`);
    }

    console.log("✅ All tickets synced successfully.");

  } catch (err) {
    console.error("❌ Error syncing ticket data:", err.response?.data || err.message);
  }
}


async function fetchContactPropertiesFromZoho(accessToken) {
  const url = 'https://www.zohoapis.com/crm/v2/settings/fields?module=Contacts';

  const zohoContactProperties = [
    "First Name",
    "Last Name",
    "Name Prefix",
    "Account Name",
    "Title",
    "Email",
    "Phone",
    "Mobile Phone",
    "Fax",
    "Twitter Username",
    "Mailing Street",
    "Mailing City",
    "Mailing Zip",
    "Mailing State",
    "Mailing Country",
    "Account",
    "Contact Owner"
  ];

  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    const allFields = response.data.fields || [];

    // Filter out fields whose field_label is in the zohoContactProperties list
    const customFields = allFields.filter(
      field => !zohoContactProperties.includes(field.field_label)
    );

    console.log(`✅ Filtered ${customFields.length} custom contact properties from Zoho`);
    return customFields;
  } catch (error) {
    console.error("❌ Error fetching contact properties from Zoho:", error.response?.data || error.message);
    throw new Error("Failed to fetch contact properties from Zoho");
  }
}

async function createProperty(property) {
  const url = `${HUBSPOT_API}/crm/v3/properties/${OBJECT_TYPE}`;
  try {
    await axios.post(url, property, {
      headers: {
        Authorization: `Bearer ${TARGET_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    // console.log(`Created property: ${property.name}`);
  } catch (err) {
    console.error(`Failed to create property: ${property.name}`, err.response?.data || err.message);
  }
}

app.get("/zoho/users/sync", async (req, res) => {
  // console.log("hi.........................")
  try {
    // const access_token = '1000.aced0f140ce2b0d80dd21452555aae2d.6f82121fa0c45ce3ae9e37187211f0c6'
    const  access_token  = await getZohoAccessToken();
    console.log("access_token", access_token);
    const users = await fetchUsersFromZoho(access_token);

    for (const user of users) {
      if (!user.email) {
        console.warn("⚠️ Skipping user with no email:", user);
        continue;
      }

      await createUserInHubSpotAsContact(user);
      const hubspotUsers = await getHubSpotUsers();
      // console.log("hubspotUsers", hubspotUsers);
    }

    res.status(200).json({
      message: "✅ Zoho users fetched and synced to HubSpot as contacts.",
    });
  } catch (err) {
    console.error("❌ Error syncing Zoho users to HubSpot:", err);
    res.status(500).json({ error: err.message });
  }
});

async function fetchUsersFromZoho(access_token) {
  // console.log("access_token", access_token);
  const url = `https://www.zohoapis.com/crm/v2/users`;

  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Zoho-oauthtoken ${access_token}`,
      }
    });
    // console.log("response", response);
    const users = response.data.users || [];
    // console.log("users", users);
    // console.log(`✅ Retrieved ${users.length} users from Zoho`);
    return users;

  } catch (error) {
    console.error("❌ Error fetching users from Zoho:", error.response?.data || error.message);
    throw error;
  }
}
async function getHubSpotUsers() {
  try {
    const response = await axios.get(`https://api.hubapi.com/settings/v3/users`, {
      headers: {
        Authorization: `Bearer ${DESTINATION_ACCESS_TOKEN}`,
      },
    });

    const users = response.data || [];
    console.log(`✅ Retrieved ${users.length} HubSpot users`);
    return users;
  } catch (error) {
    console.error("❌ Error fetching HubSpot users:", error.response?.data || error.message);
    return [];
  }
}
async function createUserInHubSpotAsContact(user) {
  // console.log("userid", user);
  try {
    const url = `https://api.hubapi.com/settings/v3/users`;

    const body = {
      properties: {
        firstname: user.first_name || "",
        lastname: user.last_name || "",
        email: user.email || "",
      },
    };

    const response = await axios.post(url, body.properties, {
      headers: {
        Authorization: `Bearer ${DESTINATION_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    });
    // console.log("response5746546", response.data);
    console.log(`✅ Created user in HubSpot: ${user.email}`);
    return response.data;
  } catch (error) {
    console.error(`❌ Failed to create HubSpot contact for ${user.email}:`, error.response?.data || error.message);
  }
}

app.get("/zoho/property", async (req, res) => {
  try {
    // const access_token = await getZohoAccessToken();
    const access_token = '1000.c19a5df54a641ccd4f267d42b475f579.e88047e5a7c45fe16344ac164c698f2a';

    const property = await fetchContactPropertiesFromZoho(access_token);
    const hubspotProperties = await createProperty(property);
    // res.status(200).json(property);
  } catch (err) {
    console.error("❌ Error fetching Zoho users:", err);
    res.status(500).json({ error: err.message });
  }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
















































































































































































































































































































































































































































































































































































































































































































































































































































































































