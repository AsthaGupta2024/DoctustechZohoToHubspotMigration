const axios = require('axios');
const logger = require('../utils/logger');
const dotenv = require('dotenv');
dotenv.config();

class HubspotService {
    constructor() {
        this.baseUrl = 'https://api.hubapi.com';
        this.apiKey = process.env.DESTINATION_ACCESS_TOKEN;
        this.client = axios.create({
            baseURL: this.baseUrl,
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            }
        });
    }

    async findObjectDataByPropertyAndValue(objectType, property, value, properties) {
        try {
            const response = await this.client.post(`/crm/v3/objects/${objectType}/search`, {
                filterGroups: [{
                    filters: [{
                        propertyName: property,
                        operator: 'EQ',
                        value: value
                    }]
                }],
                properties: properties
            });
            return response.data.results[0];
        } catch (error) {
            logger.error(`Error finding HubSpot ${objectType} by ${property} and value`, error, { value });
            return null;
        }
    }

    async findRecordByDynamicCrmId(objectType='users', property='dynamic_crm_id', recordId) {
        try {
            const response = await this.client.post(`/crm/v3/objects/${objectType}/search`, {
                filterGroups: [
                    {
                        filters: [
                            {
                                propertyName: property,
                                operator: 'EQ',
                                value: recordId
                            }
                        ]
                    }
                ],
                properties: [property],
                limit: 1
            });
            return response.data.results[0]?.id;
        } catch (error) {
            logger.error(`Error finding HubSpot ${objectType} by Zoho ID`, error, { zohoUserId });
            return null;
        }
    }

    async createNote(activity) {
        try {
            const response = await this.client.post('/crm/v3/objects/notes', {
                properties: {
                    hs_timestamp: new Date(activity.Created_Time).getTime(),
                    hs_note_body: activity.Description,
                    hs_attachment_ids: activity.Attachments || [],
                    subject: activity.Subject
                }
            });
            return response.data;
        } catch (error) {
            logger.error('Error creating HubSpot note', error, { activityId: activity.id });
            throw error;
        }
    }

    async createCall(activity) {
        try {
            const response = await this.client.post('/crm/v3/objects/calls', {
                properties: {
                    hs_timestamp: new Date(activity.Created_Time).getTime(),
                    hs_call_title: activity.Subject,
                    hs_call_body: activity.Description,
                    hs_call_duration: activity.Duration,
                    hs_call_direction: activity.Call_Type === 'Outbound' ? 'OUTBOUND' : 'INBOUND',
                    hs_call_status: activity.Status,
                    hs_attachment_ids: activity.Attachments || []
                }
            });
            return response.data;
        } catch (error) {
            logger.error('Error creating HubSpot call', error, { activityId: activity.id });
            throw error;
        }
    }

    async createMeeting(activity) {
        try {
            const response = await this.client.post('/crm/v3/objects/meetings', {
                properties: {
                    hs_timestamp: new Date(activity.Created_Time).getTime(),
                    hs_meeting_title: activity.Subject,
                    hs_meeting_body: activity.Description,
                    hs_meeting_location: activity.Location,
                    hs_meeting_outcome: activity.Status,
                    hs_attachment_ids: activity.Attachments || []
                }
            });
            return response.data;
        } catch (error) {
            logger.error('Error creating HubSpot meeting', error, { activityId: activity.id });
            throw error;
        }
    }

    async createTask(activity) {
        try {
            const response = await this.client.post('/crm/v3/objects/tasks', {
                properties: {
                    hs_timestamp: new Date(activity.Created_Time).getTime(),
                    hs_task_subject: activity.Subject,
                    hs_task_body: activity.Description,
                    hs_task_status: activity.Status,
                    hs_task_priority: activity.Priority,
                    hs_attachment_ids: activity.Attachments || []
                }
            });
            return response.data;
        } catch (error) {
            logger.error('Error creating HubSpot task', error, { activityId: activity.id });
            throw error;
        }
    }

    async createEmail(activity) {
        try {
            const response = await this.client.post('/crm/v3/objects/emails', {
                properties: {
                    hs_timestamp: new Date(activity.Created_Time).getTime(),
                    hs_email_subject: activity.Subject,
                    hs_email_body: activity.Description,
                    hs_email_status: activity.Status,
                    hs_email_direction: activity.Email_Type === 'Outbound' ? 'OUTBOUND' : 'INBOUND',
                    hs_attachment_ids: activity.Attachments || []
                }
            });
            return response.data;
        } catch (error) {
            logger.error('Error creating HubSpot email', error, { activityId: activity.id });
            throw error;
        }
    }

    async createTicket(ticketData) {
        try {
            const response = await this.client.post('/crm/v3/objects/tickets', {
                properties: ticketData
            });
            return response.data;
        } catch (error) {
            logger.error('Error creating HubSpot ticket', error, { ticketData });
            throw error;
        }
    }

    async batchCreateTickets(batchPayload) {
        try {
            const response = await this.client.post('/crm/v3/objects/tickets/batch/create', batchPayload);
            return response.data;
        } catch (error) {
            logger.error('Error batch creating HubSpot tickets', error, { batchPayload });
            throw error;
        }
    }

    
    async batchCreateAssociations(fromObjectType, toObjectType, batchPayload) {
        try {
            const endpoint = `/crm/v4/associations/${fromObjectType}/${toObjectType}/batch/create`;
            
            const response = await this.client.post(endpoint, batchPayload);
            return response.data;
        } catch (error) {
            logger.error('Error batch creating associations', error, { 
                fromObjectType, 
                toObjectType, 
                batchPayload 
            });
            throw error;
        }
    }

    async createAssociation(fromObjectType, fromObjectId, toObjectType, toObjectId, associationType) {
        try {
            await this.client.put(
                `/crm/v3/objects/${fromObjectType}/${fromObjectId}/associations/${toObjectType}/${toObjectId}/${associationType}`
            );
            logger.success('Association created successfully', {
                fromObjectType,
                fromObjectId,
                toObjectType,
                toObjectId,
                associationType
            });
        } catch (error) {
            logger.error('Error creating association', error, {
                fromObjectType,
                fromObjectId,
                toObjectType,
                toObjectId,
                associationType
            });
            throw error;
        }
    }

    async uploadAttachment(fileData, fileName, folderPath = 'Zoho/Tickets') {
         try {
            const FormData = require('form-data');
            const formData = new FormData();
            
            // Append the file buffer with the filename
            formData.append('file', fileData, {
                filename: fileName,
                contentType: 'application/octet-stream'
            });
            formData.append('options', JSON.stringify({
                access: 'PUBLIC_NOT_INDEXABLE',
                overwrite: false
              }));
            
              // Extract folder path (HubSpot folder structure)
              formData.append('folderPath', folderPath);    
            
            // Get the form data headers
            const headers = formData.getHeaders();
            
            const response = await this.client.post('/files/v3/files', formData, {
                headers: {
                    ...headers,
                    'Authorization': `Bearer ${process.env.HUBSPOT_API_KEY}`
                }
            });
            return response.data.id;
        } catch (error) {
            logger.error('Error uploading attachment', error, { fileName });
            throw error;
        }
    }

    // Create a custom object schema in HubSpot
    async createCustomObjectSchema(schema) {
        try {
            const response = await this.client.post('/crm/v3/schemas', schema);
            return response.data;
        } catch (error) {
            logger.error('Error creating HubSpot custom object schema', error, { schema });
            throw error;
        }
    }

    // Create a property (field) for a custom object in HubSpot
    async createCustomObjectProperty(objectType, property) {
        try {
            const response = await this.client.post(`/crm/v3/properties/${objectType}`, property);
            return response.data;
        } catch (error) {
            logger.error('Error creating HubSpot custom object property', error, { objectType, property });
            throw error;
        }
    }

    // Create a property group for a custom object in HubSpot
    async createPropertyGroup(objectType, group) {
        try {
            const response = await this.client.post(`/crm/v3/properties/${objectType}/groups`, group);
            return response.data;
        } catch (error) {
            // Ignore if group already exists
            if (error.response && error.response.status === 409) {
                logger.warn(`Property group '${group.name}' already exists.`);
                return group;
            }
            logger.error('Error creating HubSpot property group', error, { objectType, group });
            throw error;
        }
    }

    // Create a record for a custom object in HubSpot
    async createCustomObjectRecord(objectType, record) {
        try {
            const response = await this.client.post(`/crm/v3/objects/${objectType}`, { properties: record });
            return response.data;
        } catch (error) {
            logger.error('Error creating HubSpot custom object record', error, { objectType, record });
            throw error;
        }
    }

    // Update a record for a custom object in HubSpot
    async updateCustomObjectRecord(objectType, record, idProperty, value) {
        try {
            const response = await this.client.patch(`/crm/v3/objects/${objectType}/${value}?idProperty=${idProperty}`, { properties: record });
            return response.data;
        } catch (error) {
            logger.error('Error updating HubSpot custom object record', error, { objectType, record, idProperty, value });
            throw error;
        }
    }

    // Upsert a record for a custom object in HubSpot (search first, then create or update)
    async upsertCustomObjectRecord(objectType, record, idProperty, value) {
        try {
            // First, search for existing record
            const existingRecords = await this.findObjectDataByPropertyAndValue(objectType, idProperty, value, [idProperty]);
            
            if (existingRecords) {
                // Record exists, update it
                logger.info(`Found existing record ${objectType} with ${idProperty}=${value}, updating...`);
                return await this.updateCustomObjectRecord(objectType, record, idProperty, value);
            } else {
                // Record doesn't exist, create it
                logger.info(`No existing record ${objectType} found with ${idProperty}=${value}, creating new record...`);
                return await this.createCustomObjectRecord(objectType, record);
            }
        } catch (error) {
            logger.error('Error upserting HubSpot custom object record', error, { objectType, record, idProperty, value });
            throw error;
        }
    }

    // upsert event data
    async upsertEventRecord(record) {
        try {
            const response = await this.client.put(`/marketing/v3/marketing-events/events/${record.externalEventId}`, record);
            return response.data;

        } catch (error) {
            logger.error('Error upserting HubSpot custom object record', error, { objectType, record, idProperty, value });
            throw error;
        }
    }

    // Upsert a record for a custom object in HubSpot (search first, then create or update)
    async upsertListRecord(listname, record, dynamic_crm_type) {
        try {
            
            // First, search for existing record
            const response = await this.client.get(`/crm/v3/lists/object-type-id/${dynamic_crm_type}/name/${listname}`);
            const existingList = response.data;
            if (existingList.list && existingList.list.listId) {
                // Record exists, update it
                logger.info(`Found existing record ${listname} with ${dynamic_crm_type}, updating...`);
                logger.info(`Will not update list record ${listname} with ${dynamic_crm_type}`);
                return existingList;
            }else{
                logger.info('nothing to update record');
            }
        } catch (error) {
             if (error.response && error.response.status === 404) {
                try {
                    logger.info(`No existing record ${listname} found with ${dynamic_crm_type}, creating new record...`);
                    const response = await this.client.post(`/crm/v3/lists/`, record);
                    return response.data;
                } catch (error) {
                    logger.error('Error creating HubSpot list record', error, { record });
                    throw error;
                }
            } else {
                logger.error('Error upserting HubSpot list record', error, { listname, record, dynamic_crm_type });
                throw error;
            }
        }
    }

    // Batch create records for a custom object in HubSpot
    async batchCreateCustomObjectRecords(objectTypeId, batchPayload) {
        try {
            const response = await this.client.post(`/crm/v3/objects/${objectTypeId}/batch/create`, batchPayload);
            return response.data;
        } catch (error) {
    
            logger.error('Error batch creating HubSpot custom object records', error, { objectTypeId, batchPayload });
            throw error;
        }
    }

    // General method to update any property for a custom object in HubSpot
    async updateCustomObjectProperty(objectType, propertyName, propertyPayload) {
        try {
            const response = await this.client.patch(`/crm/v3/properties/${objectType}/${propertyName}`, propertyPayload);
            return response.data;
        } catch (error) {
            logger.error('Error updating HubSpot custom object property', error, { objectType, propertyName, propertyPayload });
            throw error;
        }
    }

    /**
     * General method to retrieve a property for a custom object in HubSpot
    */
    async getCustomObjectProperty(objectType, propertyName) {
        try {
        const response = await this.client.get(
            `/crm/v3/properties/${objectType}/${propertyName}`
        );
        return response.data;  // contains .options array with current dropdown values
        } catch (error) {
        logger.error(
            'Error fetching HubSpot custom object property',
            error,
            { objectType, propertyName }
        );
        throw error;
        }
    }
  
    // Upsert a record for a custom object in HubSpot
    async upsertCustomObjectRecord(objectType, batchPayload) {
        try {
            const response = await this.client.post(`/crm/v3/objects/${objectType}/batch/upsert`, batchPayload);
            return response.data;
        } catch (error) {
            logger.error('Error upserting HubSpot custom object record', error, { objectType, batchPayload });
            throw error;
        }
    }


    async createNote(contactId, content, createdon=null) {

        try {
            const hs_timestamp = createdon ? new Date(createdon).getTime() : Date.now();
            const payload = {
                properties: {
                hs_note_body: content,
                hs_timestamp,
                },
                associations: [
                {
                    to: { id: contactId },
                    types: [
                    {
                        associationCategory: "HUBSPOT_DEFINED",
                        associationTypeId: 202,
                    }, // <-- FIXED
                    ],
                },
                ],
            };
            const response = await this.client.post(`/crm/v3/objects/notes`, payload);
            return response.data;
        } catch (error) {
            logger.error('Error upserting HubSpot custom object record', error, { objectType, payload });
            throw error;
        }
    }
}

module.exports = new HubspotService(); 