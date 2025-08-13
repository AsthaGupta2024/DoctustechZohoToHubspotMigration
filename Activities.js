const express = require("express");
const axios = require("axios");
require("dotenv").config();
const app = express();
const hsHelpers = require('./hshelpers.js');
const BASE_URI = process.env.BASE_URI;
const FormData = require("form-data");
const path = require("path");
const fs = require("fs");
const DESTINATION_ACCESS_TOKEN = process.env.DESTINATION_ACCESS_TOKEN;
const EMAILS_LOG_FILE = path.join(__dirname, "zoho-emails.json");
const NOTES_LOG_FILE = "zoho_contact_notes_log.json"; // Local log
app.use(express.json());


async function processNotesForContacts(objectType,data, SOURCE_ACCESS_TOKEN,existingOpportunityId) {

  const email = data.Email;
  console.log("email-------->", email);
  const notes = await fetchNotesWithAttachmentsFromZohoContacts(objectType,data.id, SOURCE_ACCESS_TOKEN,existingOpportunityId);
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
async function fetchNotesWithAttachmentsFromZohoContacts(objectType,contactId, zohoAccessToken, existingOpportunityId) {
  console.log("objectType", objectType);
  console.log("📌 Fetching notes for contactId:", contactId);
  const allNotes = [];
  const notesUrl = `https://www.zohoapis.com/crm/v2/${objectType}/${contactId}/Notes`;
  
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
    // ✅ Filter: Only include notes where $se_module is 'Contacts'
    const notes = allNotes.filter(note => note.$se_module === 'Leads');
    console.log(`✅ Fetched ${notes.length} note(s) for contact ID: ${contactId}`);
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
async function processTasksForContacts(objectType,data, SOURCE_ACCESS_TOKEN,existingOpportunityId) {
  console.log("data------------------------>", data);
  const email = data.Email;
  // console.log("email-------->", email);
  const tasks = await fetchTasksFromZoho(objectType,data.id, SOURCE_ACCESS_TOKEN);
  // Sync only the current note with HubSpot or perform further processing
  await syncTasksWithHubSpot(email, tasks);
}
async function fetchTasksFromZoho(objectType,contactId, SOURCE_ACCESS_TOKEN) {
  try {
    const url = `https://www.zohoapis.com/crm/v2/${objectType}/${contactId}/Tasks`;

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
    // console.log("objecttype", objectType);
    // ✅ Filter: Only include tasks where $se_module is 'Contacts'
    const filteredTaskAssociations = associatedTasks.filter(task => task.$se_module === "Leads");

    // Optional: Log skipped tasks
    associatedTasks
      .filter(task => task.$se_module !== "Leads")
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

module.exports = {
  processNotesForContacts,
  processTasksForContacts,
  processCallsForContacts,
  processMeetingsForContacts,
  processEmailsForContacts
};















































































































































































































































































































































































































































































































































































































































































































































































































































































































