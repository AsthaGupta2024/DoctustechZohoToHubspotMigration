const fs = require('fs');
const path = require('path');
const hubspotService = require('../services/hubspotService');

class Logger {
    constructor() {
        this.successLogPath = path.join(__dirname, '../../logs/success');
        this.errorLogPath = path.join(__dirname, '../../logs/error');
        this.warnLogPath = path.join(__dirname, '../../logs/warn');
        this.infoLogPath = path.join(__dirname, '../../logs/info');
        this.ensureLogDirectories();
    }

    ensureLogDirectories() {
        [this.successLogPath, this.errorLogPath, this.warnLogPath, this.infoLogPath].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
    }

    getLogFileName(type) {
        const date = new Date().toISOString().split('T')[0];
        return `${date}-${type}.log`;
    }

    formatLogMessage(message, data = {}) {
        return JSON.stringify({
            timestamp: new Date().toISOString(),
            message,
            ...data
        }) + '\n';
    }

    success(message, data = {}) {
        const logFile = path.join(this.successLogPath, this.getLogFileName('success'));
        const logMessage = this.formatLogMessage(message, data);
        fs.appendFileSync(logFile, logMessage);
        console.log(`${message}`);
    }

    async error(message, error = null, data = {}, logType) {
        const logFile = path.join(this.errorLogPath, this.getLogFileName('error'));
        let errorData = error
            if (typeof error === "string") {
            try {
                errorData = JSON.parse(error);
            } catch {
                errorData = { error }; // fallback: keep as string
            }
            } else {
                errorData = error || {};
            }
        const logMessage = this.formatLogMessage(message, { ...data, ...errorData });
        const objectType = process.env.HS_LOG_OBJECT;

        const record = {hubspot_request:JSON.stringify(data), hubspot_response:JSON.stringify(errorData), log_type:logType}
        hubspotService.createCustomObjectRecord(objectType, record);
        fs.appendFileSync(logFile, logMessage);
        console.error(`${message}`);
    }

    warn(message, data = {}) {
        const logFile = path.join(this.warnLogPath, this.getLogFileName('warn'));
        const logMessage = this.formatLogMessage(message, data);
        fs.appendFileSync(logFile, logMessage);
        console.warn(`${message}`);
    }

    info(message, data = {}) {
        const logFile = path.join(this.infoLogPath, this.getLogFileName('info'));
        const logMessage = this.formatLogMessage(message, data);
        fs.appendFileSync(logFile, logMessage);
        console.info(`${message}`);
    }
}

module.exports = new Logger(); 