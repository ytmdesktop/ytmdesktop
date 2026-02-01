<template>
  <div class="crash-reports">
    <div class="section-header">
      <h3>Crash Reports</h3>
      <p class="description">View and manage crash reports that are automatically generated when the application encounters errors or becomes unresponsive.</p>
    </div>

    <div class="crash-reports-actions">
      <button class="btn-secondary" @click="loadCrashReports">
        <span class="material-symbols-outlined">refresh</span>
        Refresh
      </button>
      <button class="btn-secondary" :disabled="generatingTest" @click="generateTestReport">
        <span class="material-symbols-outlined">bug_report</span>
        {{ generatingTest ? "Generating..." : "Generate Test Report" }}
      </button>
    </div>

    <div v-if="loading" class="loading">
      <span class="material-symbols-outlined spinning">sync</span>
      Loading crash reports...
    </div>

    <div v-else-if="crashReports.length === 0" class="no-reports">
      <span class="material-symbols-outlined">check_circle</span>
      <p>No crash reports found. Your application has been running smoothly!</p>
    </div>

    <div v-else class="crash-reports-list">
      <div v-for="report in crashReports" :key="report.filename" class="crash-report-item" :class="{ expanded: expandedReport === report.filename }">
        <div class="crash-report-header" @click="toggleReport(report.filename)">
          <div class="crash-info">
            <span class="crash-type" :class="`type-${report.type}`">{{ report.type.toUpperCase() }}</span>
            <span class="crash-time">{{ formatTimestamp(report.timestamp) }}</span>
          </div>
          <div class="crash-actions">
            <button class="btn-danger-small" @click.stop="deleteReport(report.filename)">
              <span class="material-symbols-outlined">delete</span>
            </button>
            <span class="material-symbols-outlined expand-icon">
              {{ expandedReport === report.filename ? "expand_less" : "expand_more" }}
            </span>
          </div>
        </div>

        <div v-if="expandedReport === report.filename" class="crash-report-details">
          <div v-if="loadingDetails" class="loading-details">
            <span class="material-symbols-outlined spinning">sync</span>
            Loading details...
          </div>
          <div v-else-if="reportDetails" class="details-content">
            <div class="detail-section">
              <h4>Error Information</h4>
              <div v-if="reportDetails.error" class="error-info">
                <p><strong>Name:</strong> {{ reportDetails.error.name }}</p>
                <p><strong>Message:</strong> {{ reportDetails.error.message }}</p>
                <div v-if="reportDetails.error.stack" class="stack-trace">
                  <strong>Stack Trace:</strong>
                  <pre>{{ reportDetails.error.stack }}</pre>
                </div>
              </div>
              <div v-else class="no-error">No specific error information ({{ reportDetails.type }} event)</div>
            </div>

            <div class="detail-section">
              <h4>System Information</h4>
              <div class="system-info">
                <p><strong>Platform:</strong> {{ reportDetails.system.platform }}</p>
                <p><strong>Architecture:</strong> {{ reportDetails.system.arch }}</p>
                <p><strong>CPU:</strong> {{ reportDetails.system.cpu.model }} ({{ reportDetails.system.cpu.cores }} cores)</p>
                <p><strong>Memory:</strong> {{ formatBytes(reportDetails.system.memory.used) }} / {{ formatBytes(reportDetails.system.memory.total) }}</p>
              </div>
            </div>

            <div class="detail-section">
              <h4>Application Information</h4>
              <div class="app-info">
                <p><strong>Version:</strong> {{ reportDetails.app.version }}</p>
                <p><strong>Electron:</strong> {{ reportDetails.app.electron }}</p>
                <p><strong>Chrome:</strong> {{ reportDetails.app.chrome }}</p>
                <p><strong>Uptime:</strong> {{ formatUptime(reportDetails.process.uptime) }}</p>
              </div>
            </div>

            <div v-if="reportDetails.logs && reportDetails.logs.length" class="detail-section">
              <h4>Recent Logs ({{ reportDetails.logs.length }} lines)</h4>
              <div class="logs-container">
                <pre class="logs">{{ reportDetails.logs.join("\n") }}</pre>
              </div>
            </div>

            <div class="actions">
              <button class="btn-secondary" @click="copyToClipboard">
                <span class="material-symbols-outlined">content_copy</span>
                Copy Report
              </button>
              <button class="btn-secondary" @click="exportReport">
                <span class="material-symbols-outlined">download</span>
                Export Report
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import type { CrashReport } from "../../../main/integrations/crash-reporter";

interface CrashReportSummary {
  filename: string;
  timestamp: string;
  type: string;
}

const crashReports = ref<CrashReportSummary[]>([]);
const loading = ref(false);
const loadingDetails = ref(false);
const generatingTest = ref(false);
const expandedReport = ref<string | null>(null);
const reportDetails = ref<CrashReport | null>(null);

const loadCrashReports = async () => {
  loading.value = true;
  try {
    const reports = await window.ipcRenderer.invoke("crashReports:list");
    crashReports.value = reports || [];
  } catch (error) {
    console.error("Failed to load crash reports:", error);
    crashReports.value = [];
  } finally {
    loading.value = false;
  }
};

const toggleReport = async (filename: string) => {
  if (expandedReport.value === filename) {
    expandedReport.value = null;
    reportDetails.value = null;
    return;
  }

  expandedReport.value = filename;
  loadingDetails.value = true;

  try {
    const details = await window.ipcRenderer.invoke("crashReports:get", filename);
    reportDetails.value = details;
  } catch (error) {
    console.error("Failed to load crash report details:", error);
    reportDetails.value = null;
  } finally {
    loadingDetails.value = false;
  }
};

const deleteReport = async (filename: string) => {
  if (!confirm("Are you sure you want to delete this crash report?")) {
    return;
  }

  try {
    const success = await window.ipcRenderer.invoke("crashReports:delete", filename);
    if (success) {
      await loadCrashReports();
      if (expandedReport.value === filename) {
        expandedReport.value = null;
        reportDetails.value = null;
      }
    }
  } catch (error) {
    console.error("Failed to delete crash report:", error);
  }
};

const generateTestReport = async () => {
  generatingTest.value = true;
  try {
    await window.ipcRenderer.invoke("crashReports:generateTest");
    await loadCrashReports();
  } catch (error) {
    console.error("Failed to generate test crash report:", error);
  } finally {
    generatingTest.value = false;
  }
};

const copyToClipboard = () => {
  if (reportDetails.value) {
    navigator.clipboard.writeText(JSON.stringify(reportDetails.value, null, 2));
  }
};

const exportReport = () => {
  if (reportDetails.value) {
    const blob = new Blob([JSON.stringify(reportDetails.value, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `crash-report-${reportDetails.value.timestamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
};

const formatTimestamp = (timestamp: string): string => {
  return new Date(timestamp).toLocaleString();
};

const formatBytes = (bytes: number): string => {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
};

const formatUptime = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  return `${hours}h ${minutes}m ${secs}s`;
};

onMounted(() => {
  loadCrashReports();
});
</script>

<style scoped>
.crash-reports {
  padding: 1rem 0;
}

.section-header {
  margin-bottom: 1.5rem;
}

.section-header h3 {
  margin: 0 0 0.5rem 0;
  color: var(--text-primary);
}

.description {
  color: var(--text-secondary);
  font-size: 0.9rem;
  margin: 0;
}

.crash-reports-actions {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}

.btn-secondary,
.btn-danger-small {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border: 1px solid var(--border-color);
  background: var(--background-secondary);
  color: var(--text-primary);
  border-radius: 0.375rem;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary:hover {
  background: var(--background-hover);
}

.btn-danger-small {
  padding: 0.25rem;
  color: var(--error-color);
  border-color: var(--error-color);
}

.btn-danger-small:hover {
  background: var(--error-color);
  color: white;
}

.btn-secondary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.loading,
.no-reports {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 2rem;
  color: var(--text-secondary);
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.crash-reports-list {
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  overflow: hidden;
}

.crash-report-item {
  border-bottom: 1px solid var(--border-color);
}

.crash-report-item:last-child {
  border-bottom: none;
}

.crash-report-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  cursor: pointer;
  background: var(--background-primary);
  transition: background 0.2s;
}

.crash-report-header:hover {
  background: var(--background-secondary);
}

.crash-info {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.crash-type {
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
}

.type-crash {
  background: #fee2e2;
  color: #dc2626;
}

.type-error {
  background: #fef3c7;
  color: #d97706;
}

.type-unresponsive {
  background: #ddd6fe;
  color: #7c3aed;
}

.crash-time {
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.crash-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.expand-icon {
  color: var(--text-secondary);
}

.crash-report-details {
  border-top: 1px solid var(--border-color);
  background: var(--background-secondary);
}

.loading-details {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 2rem;
}

.details-content {
  padding: 1.5rem;
}

.detail-section {
  margin-bottom: 1.5rem;
}

.detail-section:last-child {
  margin-bottom: 0;
}

.detail-section h4 {
  margin: 0 0 0.75rem 0;
  color: var(--text-primary);
  font-size: 1rem;
}

.error-info p,
.system-info p,
.app-info p {
  margin: 0.25rem 0;
  color: var(--text-secondary);
}

.stack-trace {
  margin-top: 0.75rem;
}

.stack-trace pre {
  background: var(--background-primary);
  border: 1px solid var(--border-color);
  border-radius: 0.375rem;
  padding: 0.75rem;
  font-size: 0.8rem;
  overflow-x: auto;
  max-height: 200px;
  overflow-y: auto;
}

.logs-container {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid var(--border-color);
  border-radius: 0.375rem;
}

.logs {
  background: var(--background-primary);
  padding: 0.75rem;
  font-size: 0.8rem;
  margin: 0;
  white-space: pre-wrap;
}

.actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border-color);
}

.no-error {
  color: var(--text-secondary);
  font-style: italic;
}
</style>
