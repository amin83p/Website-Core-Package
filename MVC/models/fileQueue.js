// utils/fileQueue.js
const queue = [];
let isProcessing = false;
const logging = false;

async function queueWrite(operation) {
  if(logging) console.log('queueWrite: Adding operation to queue, current length:', queue.length);
  return new Promise((resolve, reject) => {
    queue.push({ operation, resolve, reject });
    processQueue();
  });
}

async function processQueue() {
  if (isProcessing || queue.length === 0) {
    if(logging) console.log('processQueue: Skipping, isProcessing:', isProcessing, 'Queue length:', queue.length);
    return;
  }
  isProcessing = true;
  const { operation, resolve, reject } = queue.shift();
  if(logging) console.log('processQueue: Processing operation, queue remaining:', queue.length);
  try {
    const result = await operation();
    if(logging) console.log('processQueue: Operation completed successfully');
    resolve(result);
  } catch (error) {
    if(logging) console.log('processQueue: Operation failed:', error.message);
    reject(error); // Ensure error is rejected
  } finally {
    isProcessing = false;
    if(logging) console.log('processQueue: isProcessing reset, processing next');
    if (queue.length > 0) {
      processQueue(); // Continue processing queue
    }
  }
}

module.exports = { queueWrite };