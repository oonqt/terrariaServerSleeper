class Logger {
    constructor(procname) {
        this.procname = procname;
    }
    
    info = (...msg) => {
        console.info(new Date().toISOString(), `[${this.procname}] INFO:`, ...msg);  
    }
    
    error = (...msg) => {
        console.error(new Date().toISOString(), `[${this.procname}] ERROR:`, ...msg);
    }
}

module.exports = Logger;