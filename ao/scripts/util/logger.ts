import winston, { createLogger } from 'winston'

const addNomadFields = winston.format((info, _opts) => {
  return {
    ...info,

    alloc_id: process.env.NOMAD_ALLOC_ID,
    job_name: process.env.NOMAD_JOB_NAME,
    job_id: process.env.NOMAD_JOB_ID,
    task_name: process.env.NOMAD_TASK_NAME,          
    datacenter_name: process.env.NOMAD_DC

  }
})

export const logger = createLogger({
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        addNomadFields(),
        winston.format.printf(({ level, message, context, timestamp, stack }) => {
          return `${timestamp}|${level}|${context}: ${message}${stack ? '\n' + stack : ''}`
        }),
        winston.format.json()
      ),
      handleExceptions: true
    }),
  ],
})
