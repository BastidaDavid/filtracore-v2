const links = document.querySelectorAll('.main-nav a');
const sections = document.querySelectorAll('main section');

const machines = JSON.parse(localStorage.getItem('filtracore_machines')) || [];
const filters = JSON.parse(localStorage.getItem('filtracore_filters')) || [];
const inventory = JSON.parse(localStorage.getItem('filtracore_inventory')) || [];
const maintenanceRecords = JSON.parse(localStorage.getItem('filtracore_maintenance')) || [];

const machineForm = document.querySelector('#machine-form');
const machinesList = document.querySelector('#machines-list');
const machineSearchInput = document.querySelector('#machine-search');
const machineResultsCount = document.querySelector('#machine-results-count');
const dashboardMachinesRisk = document.querySelector('#dashboard-machines-risk');
const dashboardAlertsCount = document.querySelector('#dashboard-alerts-count');
const dashboardMachinesRiskFilterBtn = document.querySelector('#dashboard-machines-risk-filter');
const dashboardAlertsFilterBtn = document.querySelector('#dashboard-alerts-filter');
const machinesRiskFilterBtn = document.querySelector('#machines-risk-filter');
const totalMachinesKpi = document.querySelectorAll('.kpi-card strong')[0];
const filterMachineSelect = document.querySelector('#filter-machine');
const filterProductSelect = document.querySelector('#filter-product');
const filterForm = document.querySelector('#filter-form');
const filtersList = document.querySelector('#filters-list');
const filtersSearchInput = document.querySelector('#filters-search');
const filtersResultsCount = document.querySelector('#filters-results-count');
const filtersTotalKpi = document.querySelector('#filters-total-kpi');
const filtersHealthyKpi = document.querySelector('#filters-healthy-kpi');
const filtersWatchKpi = document.querySelector('#filters-watch-kpi');
const filtersCriticalKpi = document.querySelector('#filters-critical-kpi');
const filtersHealthyFilterBtn = document.querySelector('#filters-healthy-filter');
const filtersWatchFilterBtn = document.querySelector('#filters-watch-filter');
const filtersCriticalFilterBtn = document.querySelector('#filters-critical-filter');
const kpis = document.querySelectorAll('.kpi-card strong');
const riskPanel = document.querySelector('#risk-panel');
const riskList = document.querySelector('#risk-list');
const inventoryForm = document.querySelector('#inventory-form');
const inventoryList = document.querySelector('#inventory-list');
const inventorySearchInput = document.querySelector('#inventory-search');
const inventoryResultsCount = document.querySelector('#inventory-results-count');
const inventoryTotalKpi = document.querySelector('#inventory-total-kpi');
const inventoryLowStockKpi = document.querySelector('#inventory-low-stock-kpi');
const inventoryValueKpi = document.querySelector('#inventory-value-kpi');
const inventoryReorderKpi = document.querySelector('#inventory-reorder-kpi');
const maintenanceForm = document.querySelector('#maintenance-form');
const maintenanceMachineSelect = document.querySelector('#maintenance-machine');
const maintenanceFilterSelect = document.querySelector('#maintenance-filter');
const maintenanceReplacementProductSelect = document.querySelector('#maintenance-replacement-product');
const maintenanceCurrentPsiInput = document.querySelector('#maintenance-current-psi');
const maintenanceCorrectedPsiInput = document.querySelector('#maintenance-corrected-psi');
const maintenancePsiChart = document.querySelector('#maintenance-psi-chart');
const maintenanceList = document.querySelector('#maintenance-list');
const maintenanceSearchInput = document.querySelector('#maintenance-search');
const maintenanceResultsCount = document.querySelector('#maintenance-results-count');
const maintenanceTotalKpi = document.querySelector('#maintenance-total-kpi');
const maintenanceWarningKpi = document.querySelector('#maintenance-warning-kpi');
const maintenanceCriticalKpi = document.querySelector('#maintenance-critical-kpi');
const maintenanceReplacementKpi = document.querySelector('#maintenance-replacement-kpi');
const monthlySpendKpi = document.querySelector('#monthly-spend');
const annualSpendKpi = document.querySelector('#annual-spend');
const riskExposureEl = document.querySelector('#risk-exposure');
const savingsEl = document.querySelector('#potential-savings');
const alertCountEl = document.querySelector('#alert-count');
const alertSummaryEl = document.querySelector('#alert-summary');
const toggleAlertsBtn = document.querySelector('#toggle-alerts');
const archiveAllAlertsBtn = document.querySelector('#archive-all-alerts');
const openAlertsCard = document.querySelector('#open-alerts-card');
const alertsModal = document.querySelector('#alerts-modal');
const closeAlertsModal = document.querySelector('#close-alerts-modal');
const closeAlertsModalFooter = document.querySelector('#close-alerts-modal-footer');
const archiveAllModalAlerts = document.querySelector('#archive-all-modal-alerts');
const modalAlertsList = document.querySelector('#modal-alerts-list');
const modalAlertCount = document.querySelector('#modal-alert-count');
const modalCriticalCount = document.querySelector('#modal-critical-count');
const modalWarningCount = document.querySelector('#modal-warning-count');
const modalRiskExposure = document.querySelector('#modal-risk-exposure');
const openManualCard = document.querySelector('#open-manual-card');
const manualModal = document.querySelector('#manual-modal');
const closeManualModal = document.querySelector('#close-manual-modal');
const closeManualModalFooter = document.querySelector('#close-manual-modal-footer');
const reportsTotalSpend = document.querySelector('#reports-total-spend');
const reportsPotentialSavings = document.querySelector('#reports-potential-savings');
const reportsRiskExposure = document.querySelector('#reports-risk-exposure');
const reportsPendingMaintenance = document.querySelector('#reports-pending-maintenance');
const reportsHealthBadge = document.querySelector('#reports-health-badge');
const reportsTotalMachines = document.querySelector('#reports-total-machines');
const reportsMachinesRisk = document.querySelector('#reports-machines-risk');
const reportsInstalledFilters = document.querySelector('#reports-installed-filters');
const reportsAlertsCount = document.querySelector('#reports-alerts-count');
const reportsAvgFilterCost = document.querySelector('#reports-avg-filter-cost');
const reportsMonthlySpend = document.querySelector('#reports-monthly-spend');
const reportsAnnualSpend = document.querySelector('#reports-annual-spend');
const reportsInventoryTotal = document.querySelector('#reports-inventory-total');
const reportsLowStock = document.querySelector('#reports-low-stock');
const reportsReorderNeeded = document.querySelector('#reports-reorder-needed');
const reportsInventoryValue = document.querySelector('#reports-inventory-value');
const generateReportSummaryBtn = document.querySelector('#generate-report-summary');
const printReportBtn = document.querySelector('#print-report');
const reportOutputCard = document.querySelector('#report-output-card');
const reportOutput = document.querySelector('#report-output');
const generateMaintenanceReportBtn = document.querySelector('#generate-maintenance-report');
const printMaintenanceReportBtn = document.querySelector('#print-maintenance-report');
const closeMaintenanceReportBtn = document.querySelector('#close-maintenance-report');
const maintenanceReportOutputCard = document.querySelector('#maintenance-report-output-card');
const maintenanceReportOutput = document.querySelector('#maintenance-report-output');
let alertsExpanded = false;
let archivedAlerts = JSON.parse(localStorage.getItem('filtracore_archivedAlerts')) || [];

function showSection(id) {
  sections.forEach(section => {
    section.style.display = 'none';
  });

  if (id === 'dashboard') {
    document.querySelector('#dashboard').style.display = 'flex';
    document.querySelector('.kpi-grid').style.display = 'grid';
    if (riskPanel) riskPanel.style.display = 'block';
  } else {
    document.querySelector('#dashboard').style.display = 'none';
    document.querySelector('.kpi-grid').style.display = 'none';
    if (riskPanel) riskPanel.style.display = 'none';
    document.querySelector('#' + id).style.display = 'block';
  }

}

function renderPsiChart(psiHistory) {
  if (!Array.isArray(psiHistory) || psiHistory.length === 0) {
    return '<p><strong>PSI Chart:</strong> No PSI data yet.</p>';
  }

  const readings = psiHistory.map(item => Number(item.psi));
  const latestPsi = readings[readings.length - 1];
  const width = 320;
  const height = 110;
  const padding = 18;
  const maxPsi = 80;
  const minPsi = 0;

  let chartStatusClass = 'psi-chart-healthy';

  if (latestPsi <= 34) {
    chartStatusClass = 'psi-chart-critical';
  } else if (latestPsi <= 49 || latestPsi > 70) {
    chartStatusClass = 'psi-chart-warning';
  }

  const getX = (index) => {
    return readings.length === 1
      ? width / 2
      : padding + (index * (width - padding * 2)) / (readings.length - 1);
  };

  const getY = (psi) => {
    return height - padding - ((psi - minPsi) / (maxPsi - minPsi)) * (height - padding * 2);
  };

  const points = readings.map((psi, index) => `${getX(index)},${getY(psi)}`).join(' ');
  const dots = readings.map((psi, index) => {
    const isLatest = index === readings.length - 1;
    const dotClass = isLatest ? 'latest-point' : '';
    const radius = isLatest ? 6 : 4;
    return `<circle class="${dotClass}" cx="${getX(index)}" cy="${getY(psi)}" r="${radius}"></circle>`;
  }).join('');
  const criticalY = getY(34);

  return `
    <div class="psi-chart ${chartStatusClass}">
      <p><strong>PSI Chart:</strong> ${readings.join(' → ')}</p>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="PSI history chart">
        <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}"></line>
        <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}"></line>
        <line class="critical-line" x1="${padding}" y1="${criticalY}" x2="${width - padding}" y2="${criticalY}"></line>
        <polyline points="${points}"></polyline>
        ${dots}
      </svg>
      <p class="chart-note">Dashed line = critical PSI threshold | Current PSI = ${latestPsi}</p>
    </div>
  `;
}

function getMachineOperationalStatus(machine) {
  const machineFilters = filters.filter(filter => filter.machineId === machine.id);

  if (machineFilters.length === 0) {
    return {
      status: 'Needs Setup',
      type: 'warning',
      filterName: 'No filter assigned',
      psi: 'N/A'
    };
  }

  let finalStatus = 'Healthy';
  let finalType = 'healthy';
  let latestPsi = 'N/A';
  let filterName = machineFilters[0].productName || 'Assigned';

  machineFilters.forEach(filter => {
    const lifecycleStatus = getFilterStatus(filter);
    const psiStatus = getPsiStatus(filter.psi);
    const psiTrend = getPsiTrend(filter.psiHistory);
    const psiPrediction = getPsiFailurePrediction(filter.psiHistory);

    if (filter.psi || filter.psi === 0) {
      latestPsi = `${filter.psi} PSI`;
    }

    if (filter.productName) {
      filterName = filter.productName;
    }

    const isCritical = lifecycleStatus === 'Expired'
      || lifecycleStatus === 'Critical'
      || psiStatus.type === 'critical'
      || psiPrediction.type === 'critical';

    const isWarning = lifecycleStatus === 'Due Soon'
      || psiStatus.type === 'warning'
      || psiTrend.type === 'warning'
      || psiPrediction.type === 'warning';

    if (isCritical) {
      finalStatus = 'At Risk';
      finalType = 'critical';
    } else if (finalType !== 'critical' && isWarning) {
      finalStatus = 'Watch';
      finalType = 'warning';
    }
  });

  return {
    status: finalStatus,
    type: finalType,
    filterName,
    psi: latestPsi
  };
}

function renderMachines() {
  totalMachinesKpi.textContent = machines.length;

  const machinesTotalKpi = document.querySelector('#machines-total-kpi');
  const machinesWithFiltersKpi = document.querySelector('#machines-with-filters-kpi');
  const machinesSetupKpi = document.querySelector('#machines-setup-kpi');
  const machinesRiskKpi = document.querySelector('#machines-risk-kpi');
  const searchValue = machineSearchInput ? machineSearchInput.value.trim().toLowerCase() : '';

  const machinesWithFilters = machines.filter(machine => {
    return filters.some(filter => filter.machineId === machine.id);
  }).length;

  const machinesNeedSetup = machines.length - machinesWithFilters;

  const machinesAtRisk = machines.filter(machine => {
    const status = getMachineOperationalStatus(machine);
    return status.type === 'critical' || status.type === 'warning';
  }).length;

  if (machinesTotalKpi) machinesTotalKpi.textContent = machines.length;
  if (machinesWithFiltersKpi) machinesWithFiltersKpi.textContent = machinesWithFilters;
  if (machinesSetupKpi) machinesSetupKpi.textContent = machinesNeedSetup;
  if (machinesRiskKpi) machinesRiskKpi.textContent = machinesAtRisk;
  if (dashboardMachinesRisk) dashboardMachinesRisk.textContent = machinesAtRisk;

  if (machines.length === 0) {
    machinesList.innerHTML = '<p class="empty-state">No machines registered yet.</p>';
    if (machineResultsCount) machineResultsCount.textContent = '0 results';
    if (dashboardMachinesRisk) dashboardMachinesRisk.textContent = '0';
    return;
  }

  const visibleMachines = machines.filter(machine => {
    const operational = getMachineOperationalStatus(machine);

    if (searchValue === 'at risk') {
      return operational.type === 'critical' || operational.type === 'warning';
    }

    const searchableText = [
      machine.name,
      machine.type,
      machine.location,
      operational.filterName,
      operational.psi,
      operational.status
    ].join(' ').toLowerCase();

    return searchableText.includes(searchValue);
  });

  if (machineResultsCount) {
    machineResultsCount.textContent = `${visibleMachines.length} of ${machines.length} machines`;
  }

  if (visibleMachines.length === 0) {
    machinesList.innerHTML = '<p class="empty-state">No machines match your search.</p>';
    return;
  }

  machinesList.innerHTML = `
    <div class="fleet-table">
      <div class="fleet-row fleet-header">
        <span>Machine</span>
        <span>Type</span>
        <span>Location</span>
        <span>Filter</span>
        <span>PSI</span>
        <span>Status</span>
      </div>

      ${visibleMachines.map(machine => {
        const operational = getMachineOperationalStatus(machine);

        return `
          <div class="fleet-row">
            <span 
              class="fleet-machine-name clickable-machine-name" 
              onclick="startMaintenanceFromMachine(${machine.id})"
              title="Click to start maintenance"
            >${machine.name}</span>
            <span>${machine.type}</span>
            <span>${machine.location}</span>
            <span>${operational.filterName}</span>
            <span>${operational.psi}</span>
            <span>
              <span class="status-pill status-${operational.type}">${operational.status}</span>
            </span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

if (machineSearchInput) {
  machineSearchInput.addEventListener('input', () => {
    renderMachines();
  });
}

function filterMachinesByRisk() {
  showSection('machines');
  setActiveNavById('machines');

  if (machineSearchInput) {
    machineSearchInput.value = 'at risk';
    renderMachines();
    machineSearchInput.focus();
  }

  const machinesSection = document.querySelector('#machines');
  if (machinesSection) {
    machinesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

if (machinesRiskFilterBtn) {
  machinesRiskFilterBtn.addEventListener('click', filterMachinesByRisk);
}

if (dashboardMachinesRiskFilterBtn) {
  dashboardMachinesRiskFilterBtn.addEventListener('click', filterMachinesByRisk);
}

if (dashboardAlertsFilterBtn) {
  dashboardAlertsFilterBtn.addEventListener('click', openAlertsModal);
}

function updateMachineOptions() {
  if (!filterMachineSelect) return;

  filterMachineSelect.innerHTML = '<option value="">Select machine</option>';

  machines.forEach(machine => {
    filterMachineSelect.innerHTML += `
      <option value="${machine.id}">
        ${machine.name} - ${machine.type}
      </option>
    `;
  });
}

function updateInventoryOptions() {
  if (!filterProductSelect) return;

  filterProductSelect.innerHTML = '<option value="">Select filter product</option>';

  inventory.forEach(item => {
    const stock = Number(item.stock) || 0;
    filterProductSelect.innerHTML += `
      <option value="${item.id}">
        ${item.name} (Stock: ${stock})
      </option>
    `;
  });
}

function updateMaintenanceOptions() {
  if (maintenanceMachineSelect) {
    maintenanceMachineSelect.innerHTML = '<option value="">Select machine</option>';

    machines.forEach(machine => {
      maintenanceMachineSelect.innerHTML += `
        <option value="${machine.id}">
          ${machine.name} - ${machine.type}
        </option>
      `;
    });
  }

  if (maintenanceFilterSelect) {
    maintenanceFilterSelect.innerHTML = '<option value="">Select filter (optional)</option>';

    filters.forEach(filter => {
      const machine = machines.find(machine => machine.id === filter.machineId);
      maintenanceFilterSelect.innerHTML += `
        <option value="${filter.id}">
          ${filter.productName || 'Filter'} ${machine ? '- ' + machine.name : ''}
        </option>
      `;
    });
  }

  if (maintenanceReplacementProductSelect) {
    maintenanceReplacementProductSelect.innerHTML = '<option value="">Only select if replacing filter</option>';

    inventory.forEach(item => {
      const stock = Number(item.stock) || 0;
      maintenanceReplacementProductSelect.innerHTML += `
        <option value="${item.id}" ${stock <= 0 ? 'disabled' : ''}>
          ${item.name} (Stock: ${stock})
        </option>
      `;
    });
  }
}

function updateMaintenancePsiPreview() {
  const filterId = Number(maintenanceFilterSelect?.value) || null;

  if (!filterId) {
    if (maintenanceCurrentPsiInput) {
      maintenanceCurrentPsiInput.value = '';
      maintenanceCurrentPsiInput.placeholder = 'Select a filter to view PSI';
    }

    if (maintenancePsiChart) {
      maintenancePsiChart.innerHTML = '<p class="empty-state">Select a filter to view PSI history.</p>';
    }

    return;
  }

  const filter = filters.find(filter => filter.id === filterId);

  if (!filter) {
    if (maintenanceCurrentPsiInput) {
      maintenanceCurrentPsiInput.value = '';
      maintenanceCurrentPsiInput.placeholder = 'Filter not found';
    }

    if (maintenancePsiChart) {
      maintenancePsiChart.innerHTML = '<p class="empty-state">Filter not found.</p>';
    }

    return;
  }

  if (maintenanceCurrentPsiInput) {
    if (filter.psi || filter.psi === 0) {
      const psiStatus = getPsiStatus(filter.psi);
      maintenanceCurrentPsiInput.value = `${filter.psi} PSI - ${psiStatus.status}`;
    } else {
      maintenanceCurrentPsiInput.value = 'No PSI recorded';
    }
  }

  if (maintenancePsiChart) {
    maintenancePsiChart.innerHTML = renderPsiChart(filter.psiHistory);
  }
}

if (maintenanceFilterSelect) {
  maintenanceFilterSelect.addEventListener('change', updateMaintenancePsiPreview);
}

if (maintenanceMachineSelect) {
  maintenanceMachineSelect.addEventListener('change', () => {
    const machineId = Number(maintenanceMachineSelect.value) || null;
    const machineFilters = filters.filter(filter => filter.machineId === machineId);

    if (maintenanceFilterSelect && machineFilters.length > 0) {
      maintenanceFilterSelect.value = String(machineFilters[machineFilters.length - 1].id);
    }

    updateMaintenancePsiPreview();
  });
}

function addMonths(date, months) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + Number(months || 0));
  return result;
}

function getDaysBetween(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  return Math.ceil((end - start) / (1000 * 60 * 60 * 24));
}

function getFilterStatus(filter) {
  const today = new Date();
  const dueDate = filter.dueDate ? new Date(filter.dueDate) : addMonths(filter.installedAt, filter.lifeMonths);
  const daysRemaining = getDaysBetween(today, dueDate);

  if (daysRemaining <= 0) return 'Expired';
  if (daysRemaining <= 30) return 'Critical';
  if (daysRemaining <= 90) return 'Due Soon';
  return 'Active';
}

function getFilterOperationalStatus(filter) {
  const lifecycleStatus = getFilterStatus(filter);
  const psiStatus = getPsiStatus(filter.psi);
  const psiTrend = getPsiTrend(filter.psiHistory);
  const psiPrediction = getPsiFailurePrediction(filter.psiHistory);

  if (
    lifecycleStatus === 'Expired' ||
    lifecycleStatus === 'Critical' ||
    psiStatus.type === 'critical' ||
    psiPrediction.type === 'critical'
  ) {
    return {
      status: 'Critical',
      type: 'critical',
      reason: lifecycleStatus !== 'Active' ? lifecycleStatus : psiStatus.message
    };
  }

  if (
    lifecycleStatus === 'Due Soon' ||
    psiStatus.type === 'warning' ||
    psiTrend.type === 'warning' ||
    psiPrediction.type === 'warning'
  ) {
    return {
      status: 'Watch',
      type: 'warning',
      reason: lifecycleStatus !== 'Active' ? lifecycleStatus : psiStatus.message
    };
  }

  return {
    status: 'Healthy',
    type: 'healthy',
    reason: 'Lifecycle and PSI are within expected range.'
  };
}


function getDefaultLifeMonths(category) {
  const normalizedCategory = String(category || '').toLowerCase();

  if (normalizedCategory.includes('ice')) return 12;
  if (normalizedCategory.includes('coffee')) return 6;
  if (normalizedCategory.includes('soda')) return 6;
  if (normalizedCategory.includes('refrigeration')) return 12;
  if (normalizedCategory.includes('water')) return 6;

  return 6;
}

function getPsiStatus(psi) {
  const value = Number(psi);

  if (!psi && psi !== 0) {
    return {
      status: 'Not recorded',
      type: 'neutral',
      message: 'No PSI reading recorded yet.'
    };
  }

  if (value <= 34) {
    return {
      status: 'Critical',
      type: 'critical',
      message: 'PSI is critically low. Inspect filter, water line, or pressure supply immediately.'
    };
  }

  if (value <= 49) {
    return {
      status: 'Warning',
      type: 'warning',
      message: 'PSI is below the healthy range. Monitor and schedule inspection.'
    };
  }

  if (value <= 70) {
    return {
      status: 'Healthy',
      type: 'healthy',
      message: 'PSI is within the expected operating range.'
    };
  }

  return {
    status: 'High Pressure',
    type: 'warning',
    message: 'PSI is above the expected range. Check regulator or incoming pressure.'
  };
}

function getPsiTrend(psiHistory) {
  if (!Array.isArray(psiHistory) || psiHistory.length < 2) {
    return {
      trend: 'No data',
      type: 'neutral',
      message: 'Not enough PSI readings to determine trend.'
    };
  }

  const lastReading = psiHistory[psiHistory.length - 1];
  const previousReading = psiHistory[psiHistory.length - 2];
  const lastPsi = Number(lastReading.psi);
  const previousPsi = Number(previousReading.psi);
  const change = lastPsi - previousPsi;

  if (change <= -5) {
    return {
      trend: 'Dropping',
      type: 'warning',
      message: `PSI dropped by ${Math.abs(change)} since the last reading. Possible filter saturation or pressure restriction.`
    };
  }

  if (change >= 5) {
    return {
      trend: 'Increasing',
      type: 'warning',
      message: `PSI increased by ${change} since the last reading. Check regulator or incoming pressure.`
    };
  }

  return {
    trend: 'Stable',
    type: 'healthy',
    message: `PSI changed by ${change}. Pressure trend is stable.`
  };
}

function getPsiFailurePrediction(psiHistory) {
  if (!Array.isArray(psiHistory) || psiHistory.length < 2) {
    return {
      prediction: 'No prediction',
      type: 'neutral',
      message: 'Not enough PSI readings to predict failure.'
    };
  }

  const lastReading = psiHistory[psiHistory.length - 1];
  const previousReading = psiHistory[psiHistory.length - 2];
  const lastPsi = Number(lastReading.psi);
  const previousPsi = Number(previousReading.psi);
  const change = lastPsi - previousPsi;

  if (lastPsi <= 34) {
    return {
      prediction: 'Already critical',
      type: 'critical',
      message: 'PSI is already at or below the critical limit. Inspect immediately.'
    };
  }

  if (change >= 0) {
    return {
      prediction: 'Stable',
      type: 'healthy',
      message: 'PSI is not dropping. No immediate failure prediction.'
    };
  }

  const criticalLimit = 34;
  const psiUntilCritical = lastPsi - criticalLimit;
  const dropPerReading = Math.abs(change);
  const readingsUntilCritical = Math.ceil(psiUntilCritical / dropPerReading);

  return {
    prediction: `${readingsUntilCritical} readings`,
    type: readingsUntilCritical <= 2 ? 'critical' : 'warning',
    message: `If PSI keeps dropping at this rate, it may reach critical level in about ${readingsUntilCritical} readings.`
  };
}

function updateFilterPsi(filterId) {
  const input = document.querySelector(`#psi-update-${filterId}`);

  if (!input || input.value === '') {
    alert('Enter a PSI value');
    return;
  }

  const newPsi = Number(input.value);
  const filter = filters.find(filter => filter.id === filterId);

  if (!filter) {
    alert('Filter not found');
    return;
  }

  filter.psi = newPsi;

  if (!Array.isArray(filter.psiHistory)) {
    filter.psiHistory = [];
  }

  filter.psiHistory.push({
    date: new Date().toISOString(),
    psi: newPsi
  });

  localStorage.setItem('filtracore_filters', JSON.stringify(filters));
  renderMachines();
  renderFilters();
  renderMaintenance();
  updateMaintenancePsiPreview();
  renderRiskScore();
  renderFinancialMetrics();
  renderReports();
}

function renderFilters() {
  if (!filtersList) return;

  const searchValue = filtersSearchInput ? filtersSearchInput.value.trim().toLowerCase() : '';

  let healthy = 0;
  let watch = 0;
  let critical = 0;

  filters.forEach(filter => {
    const operational = getFilterOperationalStatus(filter);

    if (operational.type === 'healthy') healthy++;
    if (operational.type === 'warning') watch++;
    if (operational.type === 'critical') critical++;
  });

  if (filtersTotalKpi) filtersTotalKpi.textContent = filters.length;
  if (filtersHealthyKpi) filtersHealthyKpi.textContent = healthy;
  if (filtersWatchKpi) filtersWatchKpi.textContent = watch;
  if (filtersCriticalKpi) filtersCriticalKpi.textContent = critical;

  if (filters.length === 0) {
    filtersList.innerHTML = '<p class="empty-state">No filters registered yet.</p>';
    if (filtersResultsCount) filtersResultsCount.textContent = '0 results';
    if (kpis[1]) kpis[1].textContent = 0;
    return;
  }

  const visibleFilters = filters.filter(filter => {
    const machine = machines.find(machine => machine.id === filter.machineId);
    const operational = getFilterOperationalStatus(filter);
    const dueDate = filter.dueDate ? new Date(filter.dueDate) : addMonths(filter.installedAt, filter.lifeMonths);
    const daysRemaining = getDaysBetween(new Date(), dueDate);
    const psiText = filter.psi || filter.psi === 0 ? `${filter.psi} PSI` : 'Not recorded';

    const searchableText = [
      machine ? machine.name : 'Unknown Machine',
      filter.productName,
      dueDate.toLocaleDateString(),
      daysRemaining <= 0 ? 'Expired' : `${daysRemaining} days`,
      psiText,
      operational.status,
      operational.reason
    ].join(' ').toLowerCase();

    return searchableText.includes(searchValue);
  });

  if (filtersResultsCount) {
    filtersResultsCount.textContent = `${visibleFilters.length} of ${filters.length} filters`;
  }

  if (visibleFilters.length === 0) {
    filtersList.innerHTML = '<p class="empty-state">No filters match your search.</p>';
    return;
  }

  filtersList.innerHTML = `
    <div class="filters-table">
      <div class="filters-row filters-header">
        <span>Machine</span>
        <span>Filter</span>
        <span>Due Date</span>
        <span>Days Left</span>
        <span>PSI</span>
        <span>Status</span>
        <span>Actions</span>
      </div>

      ${visibleFilters.map(filter => {
        const machine = machines.find(machine => machine.id === filter.machineId);
        const operational = getFilterOperationalStatus(filter);
        const dueDate = filter.dueDate ? new Date(filter.dueDate) : addMonths(filter.installedAt, filter.lifeMonths);
        const daysRemaining = getDaysBetween(new Date(), dueDate);
        const psiText = filter.psi || filter.psi === 0 ? `${filter.psi} PSI` : 'Not recorded';

        return `
          <div class="filters-row">
            <span class="filters-machine-name">${machine ? machine.name : 'Unknown Machine'}</span>
            <span class="filters-product-name">${filter.productName || 'N/A'}</span>
            <span>${dueDate.toLocaleDateString()}</span>
            <span>${daysRemaining <= 0 ? 'Expired' : `${daysRemaining} days`}</span>
            <span>${psiText}</span>
            <span>
              <span class="status-pill status-${operational.type}">${operational.status}</span>
            </span>
            <span class="filter-actions">
              <input type="number" id="psi-update-${filter.id}" class="filter-psi-input" placeholder="PSI" />
              <button type="button" class="filter-action-btn filter-update-btn" onclick="updateFilterPsi(${filter.id})">Update PSI</button>
              <button type="button" class="filter-action-btn filter-maintenance-btn" onclick="startMaintenanceFromFilter(${filter.id})">Maintenance</button>
            </span>
          </div>
        `;
      }).join('')}
    </div>
  `;

  if (kpis[1]) kpis[1].textContent = filters.length;
}

if (filtersSearchInput) {
  filtersSearchInput.addEventListener('input', () => {
    renderFilters();
  });
}

function filterFiltersByStatus(status) {
  showSection('filters');
  setActiveNavById('filters');

  if (filtersSearchInput) {
    filtersSearchInput.value = status;
    renderFilters();
    filtersSearchInput.focus();
  }

  const filtersSection = document.querySelector('#filters');
  if (filtersSection) {
    filtersSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

if (filtersHealthyFilterBtn) {
  filtersHealthyFilterBtn.addEventListener('click', () => {
    filterFiltersByStatus('healthy');
  });
}

if (filtersWatchFilterBtn) {
  filtersWatchFilterBtn.addEventListener('click', () => {
    filterFiltersByStatus('watch');
  });
}

if (filtersCriticalFilterBtn) {
  filtersCriticalFilterBtn.addEventListener('click', () => {
    filterFiltersByStatus('critical');
  });
}

function startMaintenanceFromMachine(machineId) {
  const machine = machines.find(machine => machine.id === machineId);

  if (!machine) {
    alert('Machine not found');
    return;
  }

  const machineFilters = filters.filter(filter => filter.machineId === machine.id);
  const latestFilter = machineFilters.length > 0 ? machineFilters[machineFilters.length - 1] : null;
  const operational = getMachineOperationalStatus(machine);
  const today = new Date().toISOString().split('T')[0];

  showSection('maintenance');
  setActiveNavById('maintenance');
  updateMaintenanceOptions();

  if (maintenanceMachineSelect) {
    maintenanceMachineSelect.value = String(machine.id);
  }

  if (maintenanceFilterSelect && latestFilter) {
    maintenanceFilterSelect.value = String(latestFilter.id);
  }
  updateMaintenancePsiPreview();

  const maintenanceTypeInput = document.querySelector('#maintenance-type');
  const maintenanceDateInput = document.querySelector('#maintenance-date');
  const maintenanceNotesInput = document.querySelector('#maintenance-notes');

  if (maintenanceTypeInput) {
    if (operational.type === 'critical') {
      maintenanceTypeInput.value = 'Critical Inspection';
    } else if (operational.type === 'warning') {
      maintenanceTypeInput.value = 'Warning Review';
    } else {
      maintenanceTypeInput.value = 'General Inspection';
    }
  }

  if (maintenanceDateInput) {
    maintenanceDateInput.value = today;
  }

  if (maintenanceNotesInput) {
    maintenanceNotesInput.value = `Maintenance request for ${machine.name}. Current status: ${operational.status}. Filter: ${operational.filterName}. PSI: ${operational.psi}.`;
  }

  const maintenanceSection = document.querySelector('#maintenance');
  if (maintenanceSection) {
    maintenanceSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function startMaintenanceFromFilter(filterId) {
  const filter = filters.find(filter => filter.id === filterId);

  if (!filter) {
    alert('Filter not found');
    return;
  }

  const machine = machines.find(machine => machine.id === filter.machineId);
  const operational = getFilterOperationalStatus(filter);
  const today = new Date().toISOString().split('T')[0];

  showSection('maintenance');
  setActiveNavById('maintenance');
  updateMaintenanceOptions();

  if (maintenanceMachineSelect && machine) {
    maintenanceMachineSelect.value = String(machine.id);
  }

  if (maintenanceFilterSelect) {
    maintenanceFilterSelect.value = String(filter.id);
  }
  updateMaintenancePsiPreview();

  const maintenanceTypeInput = document.querySelector('#maintenance-type');
  const maintenanceDateInput = document.querySelector('#maintenance-date');
  const maintenanceNotesInput = document.querySelector('#maintenance-notes');

  if (maintenanceTypeInput) {
    maintenanceTypeInput.value = operational.type === 'critical' ? 'Critical Inspection' : 'Warning Review';
  }

  if (maintenanceDateInput) {
    maintenanceDateInput.value = today;
  }

  if (maintenanceNotesInput) {
    maintenanceNotesInput.value = `Filter Maintenance Request: ${filter.productName || 'Filter'} on ${machine ? machine.name : 'Unknown Machine'}. Status: ${operational.status}. Reason: ${operational.reason}`;
  }

  const maintenanceSection = document.querySelector('#maintenance');
  if (maintenanceSection) {
    maintenanceSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function renderCostMetrics() {
  const totalSpendEl = document.querySelector('#total-spend');
  const averageCostEl = document.querySelector('#avg-filter-cost');

  const totalSpend = filters.reduce((sum, filter) => {
    return sum + Number(filter.cost || 0);
  }, 0);

  const averageCost = filters.length > 0 ? totalSpend / filters.length : 0;

  if (totalSpendEl) {
    totalSpendEl.textContent = `$${totalSpend.toFixed(2)}`;
  }

  if (averageCostEl) {
    averageCostEl.textContent = `$${averageCost.toFixed(2)}`;
  }

  const estimatedMonthlySpend = getEstimatedMonthlySpend();

  if (monthlySpendKpi) {
    monthlySpendKpi.textContent = `$${estimatedMonthlySpend.toFixed(2)}`;
  }

  if (annualSpendKpi) {
    annualSpendKpi.textContent = `$${(estimatedMonthlySpend * 12).toFixed(2)}`;
  }
}

function getEstimatedMonthlySpend() {
  if (filters.length === 0) return 0;

  return filters.reduce((total, filter) => {
    const cost = Number(filter.cost || 0);
    const lifeMonths = Number(filter.lifeMonths || 1);
    return total + (cost / lifeMonths);
  }, 0);
}


function getCostPerMachine() {
  return machines.map(machine => {
    const machineFilters = filters.filter(filter => filter.machineId === machine.id);

    const totalCost = machineFilters.reduce((sum, filter) => {
      return sum + Number(filter.cost || 0);
    }, 0);

    return {
      machineId: machine.id,
      machineName: machine.name,
      totalCost,
      filterCount: machineFilters.length
    };
  });
}

function getInventoryPredictions() {
  return inventory.map(item => {
    const stock = Number(item.stock) || 0;
    const productFilters = filters.filter(filter => filter.productId === item.id);
    const itemLifeMonths = Number(item.lifeMonths || getDefaultLifeMonths(item.category));

    if (productFilters.length === 0) {
      return {
        productName: item.name,
        stock,
        monthlyUsage: 0,
        coverageMonths: null,
        status: 'No usage data yet'
      };
    }

    const monthlyUsage = productFilters.reduce((total, filter) => {
      const lifeMonths = Number(filter.lifeMonths || itemLifeMonths || 1);
      return total + (1 / lifeMonths);
    }, 0);

    const coverageMonths = monthlyUsage > 0 ? stock / monthlyUsage : null;

    let status = 'Stable';
    let action = 'No action needed';

    if (coverageMonths !== null && coverageMonths <= 1) {
      status = 'Critical runout risk';
      action = 'Reorder immediately';
    } else if (coverageMonths !== null && coverageMonths <= 3) {
      status = 'Reorder planning';
      action = 'Plan reorder soon';
    } else if (coverageMonths !== null && coverageMonths <= 6) {
      status = 'Monitor usage';
      action = 'Monitor monthly consumption';
    }

    return {
      productName: item.name,
      stock,
      monthlyUsage,
      coverageMonths,
      status,
      action
    };
  });
}

function renderReports() {
  const alerts = getVisibleAlerts();
  const riskData = getFinancialRisk();
  const risk = riskData.total;
  const savings = getPotentialSavings();
  const pendingMaintenance = getPendingMaintenanceItems();

  const machinesAtRisk = machines.filter(machine => {
    const status = getMachineOperationalStatus(machine);
    return status.type === 'critical' || status.type === 'warning';
  }).length;

  const totalSpend = filters.reduce((sum, filter) => {
    return sum + Number(filter.cost || 0);
  }, 0);

  const avgFilterCost = filters.length > 0 ? totalSpend / filters.length : 0;
  const monthlySpend = getEstimatedMonthlySpend();
  const annualSpend = monthlySpend * 12;

  const lowStockItems = inventory.filter(item => {
    const stock = Number(item.stock) || 0;
    const reorderLevel = Number(item.reorderLevel) || 0;
    return stock > 0 && stock <= reorderLevel;
  }).length;

  const reorderNeeded = inventory.filter(item => {
    const stock = Number(item.stock) || 0;
    return stock <= 0;
  }).length;

  const inventoryValue = inventory.reduce((total, item) => {
    const stock = Number(item.stock) || 0;
    const unitCost = Number(item.unitCost ?? item.cost) || 0;
    return total + (stock * unitCost);
  }, 0);

  const health = getSystemHealth();

  if (reportsTotalSpend) reportsTotalSpend.textContent = `$${totalSpend.toFixed(2)}`;
  if (reportsPotentialSavings) reportsPotentialSavings.textContent = `$${savings.toFixed(2)}`;
  if (reportsRiskExposure) reportsRiskExposure.textContent = `$${risk.toFixed(2)}`;
  if (reportsPendingMaintenance) reportsPendingMaintenance.textContent = pendingMaintenance.length;

  if (reportsTotalMachines) reportsTotalMachines.textContent = machines.length;
  if (reportsMachinesRisk) reportsMachinesRisk.textContent = machinesAtRisk;
  if (reportsInstalledFilters) reportsInstalledFilters.textContent = filters.length;
  if (reportsAlertsCount) reportsAlertsCount.textContent = alerts.length;

  if (reportsAvgFilterCost) reportsAvgFilterCost.textContent = `$${avgFilterCost.toFixed(2)}`;
  if (reportsMonthlySpend) reportsMonthlySpend.textContent = `$${monthlySpend.toFixed(2)}`;
  if (reportsAnnualSpend) reportsAnnualSpend.textContent = `$${annualSpend.toFixed(2)}`;

  if (reportsInventoryTotal) reportsInventoryTotal.textContent = inventory.length;
  if (reportsLowStock) reportsLowStock.textContent = lowStockItems;
  if (reportsReorderNeeded) reportsReorderNeeded.textContent = reorderNeeded;
  if (reportsInventoryValue) reportsInventoryValue.textContent = `$${inventoryValue.toFixed(2)}`;

  if (reportsHealthBadge) {
    reportsHealthBadge.classList.remove('warning', 'critical');

    if (health >= 80) {
      reportsHealthBadge.textContent = `Healthy ${health}%`;
    } else if (health >= 50) {
      reportsHealthBadge.textContent = `Watch ${health}%`;
      reportsHealthBadge.classList.add('warning');
    } else {
      reportsHealthBadge.textContent = `Critical ${health}%`;
      reportsHealthBadge.classList.add('critical');
    }
  }
}

function renderCostPerMachine() {
  renderReports();
}

function generateReportSummary() {
  if (!reportOutputCard || !reportOutput) return;

  const alerts = getVisibleAlerts();
  const riskData = getFinancialRisk();
  const pendingMaintenance = getPendingMaintenanceItems();
  const machinesAtRisk = machines.filter(machine => {
    const status = getMachineOperationalStatus(machine);
    return status.type === 'critical' || status.type === 'warning';
  }).length;

  const totalSpend = filters.reduce((sum, filter) => sum + Number(filter.cost || 0), 0);
  const monthlySpend = getEstimatedMonthlySpend();
  const inventoryValue = inventory.reduce((total, item) => {
    const stock = Number(item.stock) || 0;
    const unitCost = Number(item.unitCost ?? item.cost) || 0;
    return total + (stock * unitCost);
  }, 0);

  const criticalAlerts = alerts.filter(alert => alert.type === 'critical').length;
  const warningAlerts = alerts.filter(alert => alert.type === 'warning').length;

  reportOutput.innerHTML = `
    <h4>FiltraCore Operational Summary</h4>
    <ul>
      <li><strong>Total machines:</strong> ${machines.length}</li>
      <li><strong>Installed filters:</strong> ${filters.length}</li>
      <li><strong>Machines at risk:</strong> ${machinesAtRisk}</li>
      <li><strong>Active intelligence alerts:</strong> ${alerts.length} (${criticalAlerts} critical / ${warningAlerts} warning)</li>
      <li><strong>Pending maintenance items:</strong> ${pendingMaintenance.length}</li>
      <li><strong>Total installed filter spend:</strong> $${totalSpend.toFixed(2)}</li>
      <li><strong>Estimated monthly filter spend:</strong> $${monthlySpend.toFixed(2)}</li>
      <li><strong>Estimated risk exposure:</strong> $${riskData.total.toFixed(2)}</li>
      <li><strong>Inventory value:</strong> $${inventoryValue.toFixed(2)}</li>
    </ul>
  `;

  reportOutputCard.style.display = 'block';
  reportOutputCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

if (generateReportSummaryBtn) {
  generateReportSummaryBtn.addEventListener('click', generateReportSummary);
}

if (printReportBtn) {
  printReportBtn.addEventListener('click', () => {
    renderReports();
    window.print();
  });
}

function getInventoryStockStatus(item) {
  const stock = Number(item.stock) || 0;
  const reorderLevel = Number(item.reorderLevel) || 0;

  if (stock <= 0) {
    return {
      status: 'Reorder',
      type: 'reorder'
    };
  }

  if (stock <= reorderLevel) {
    return {
      status: 'Low Stock',
      type: 'low'
    };
  }

  return {
    status: 'Available',
    type: 'good'
  };
}

function renderInventory() {
  if (!inventoryList) return;

  const searchValue = inventorySearchInput ? inventorySearchInput.value.trim().toLowerCase() : '';

  const lowStockItems = inventory.filter(item => {
    const stock = Number(item.stock) || 0;
    const reorderLevel = Number(item.reorderLevel) || 0;
    return stock > 0 && stock <= reorderLevel;
  }).length;

  const reorderItems = inventory.filter(item => {
    const stock = Number(item.stock) || 0;
    return stock <= 0;
  }).length;

  const totalValue = inventory.reduce((total, item) => {
    const stock = Number(item.stock) || 0;
    const unitCost = Number(item.unitCost ?? item.cost) || 0;
    return total + (stock * unitCost);
  }, 0);

  if (inventoryTotalKpi) inventoryTotalKpi.textContent = inventory.length;
  if (inventoryLowStockKpi) inventoryLowStockKpi.textContent = lowStockItems;
  if (inventoryValueKpi) inventoryValueKpi.textContent = `$${totalValue.toFixed(2)}`;
  if (inventoryReorderKpi) inventoryReorderKpi.textContent = reorderItems;

  if (inventory.length === 0) {
    inventoryList.innerHTML = '<p class="empty-state">No inventory items registered yet.</p>';
    if (inventoryResultsCount) inventoryResultsCount.textContent = '0 results';
    return;
  }

  const visibleInventory = inventory.filter(item => {
    const stock = Number(item.stock) || 0;
    const reorderLevel = Number(item.reorderLevel) || 0;
    const unitCost = Number(item.unitCost ?? item.cost) || 0;
    const stockStatus = getInventoryStockStatus(item);

    const searchableText = [
      item.name,
      item.category,
      stock,
      unitCost,
      reorderLevel,
      stockStatus.status
    ].join(' ').toLowerCase();

    return searchableText.includes(searchValue);
  });

  if (inventoryResultsCount) {
    inventoryResultsCount.textContent = `${visibleInventory.length} of ${inventory.length} items`;
  }

  if (visibleInventory.length === 0) {
    inventoryList.innerHTML = '<p class="empty-state">No inventory items match your search.</p>';
    return;
  }

  inventoryList.innerHTML = `
    <div class="inventory-table">
      <div class="inventory-row inventory-header">
        <span>Filter</span>
        <span>Category</span>
        <span>Stock</span>
        <span>Unit Cost</span>
        <span>Reorder Level</span>
        <span>Status</span>
      </div>

      ${visibleInventory.map(item => {
        const stock = Number(item.stock) || 0;
        const reorderLevel = Number(item.reorderLevel) || 0;
        const unitCost = Number(item.unitCost ?? item.cost) || 0;
        const stockStatus = getInventoryStockStatus(item);

        return `
          <div class="inventory-row">
            <span class="inventory-item-name">${item.name}</span>
            <span>${item.category || 'Uncategorized'}</span>
            <span>${stock}</span>
            <span>$${unitCost.toFixed(2)}</span>
            <span>${reorderLevel}</span>
            <span>
              <span class="stock-pill stock-${stockStatus.type}">${stockStatus.status}</span>
            </span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

if (inventorySearchInput) {
  inventorySearchInput.addEventListener('input', () => {
    renderInventory();
  });
}

function getMaintenanceTypeStatus(type) {
  const normalizedType = String(type || '').toLowerCase();

  if (normalizedType.includes('critical')) {
    return {
      label: 'Critical',
      type: 'critical'
    };
  }

  if (normalizedType.includes('replace')) {
    return {
      label: 'Replacement',
      type: 'replacement'
    };
  }

  if (normalizedType.includes('warning') || normalizedType.includes('review') || normalizedType.includes('inspection')) {
    return {
      label: 'Review',
      type: 'review'
    };
  }

  return {
    label: 'General',
    type: 'general'
  };
}

function getPendingMaintenanceItems() {
  return filters.map(filter => {
    const machine = machines.find(machine => machine.id === filter.machineId);
    const operational = getFilterOperationalStatus(filter);

    return {
      filter,
      machine,
      operational
    };
  }).filter(item => item.operational.type === 'warning' || item.operational.type === 'critical');
}

function renderMaintenance() {
  if (!maintenanceList) return;

  const searchValue = maintenanceSearchInput ? maintenanceSearchInput.value.trim().toLowerCase() : '';
  const pendingMaintenance = getPendingMaintenanceItems();

  const warningReviews = maintenanceRecords.filter(record => {
    const typeStatus = getMaintenanceTypeStatus(record.type);
    return typeStatus.type === 'review';
  }).length;

  const criticalInspections = maintenanceRecords.filter(record => {
    const typeStatus = getMaintenanceTypeStatus(record.type);
    return typeStatus.type === 'critical';
  }).length;

  const replacements = maintenanceRecords.filter(record => {
    const typeStatus = getMaintenanceTypeStatus(record.type);
    return typeStatus.type === 'replacement';
  }).length;

  if (maintenanceTotalKpi) maintenanceTotalKpi.textContent = maintenanceRecords.length;
  if (maintenanceWarningKpi) maintenanceWarningKpi.textContent = warningReviews;
  if (maintenanceCriticalKpi) maintenanceCriticalKpi.textContent = criticalInspections;
  if (maintenanceReplacementKpi) maintenanceReplacementKpi.textContent = replacements;

  const visiblePending = pendingMaintenance.filter(item => {
    const searchableText = [
      item.machine ? item.machine.name : 'Unknown Machine',
      item.filter.productName,
      item.operational.status,
      item.operational.reason,
      item.filter.psi || item.filter.psi === 0 ? `${item.filter.psi} PSI` : 'No PSI'
    ].join(' ').toLowerCase();

    return searchableText.includes(searchValue);
  });

  const visibleRecords = maintenanceRecords.filter(record => {
    const machine = machines.find(machine => machine.id === record.machineId);
    const filter = filters.find(filter => filter.id === record.filterId);
    const typeStatus = getMaintenanceTypeStatus(record.type);
    const dateText = record.date ? new Date(record.date).toLocaleDateString() : 'Not recorded';

    const searchableText = [
      dateText,
      machine ? machine.name : 'Unknown Machine',
      filter ? filter.productName : 'Not assigned',
      record.type,
      record.notes,
      typeStatus.label
    ].join(' ').toLowerCase();

    return searchableText.includes(searchValue);
  });

  if (maintenanceResultsCount) {
    const totalVisible = visiblePending.length + visibleRecords.length;
    const totalItems = pendingMaintenance.length + maintenanceRecords.length;
    maintenanceResultsCount.textContent = `${totalVisible} of ${totalItems} items`;
  }

  if (pendingMaintenance.length === 0 && maintenanceRecords.length === 0) {
    maintenanceList.innerHTML = '<p class="empty-state">No pending maintenance or maintenance records yet.</p>';
    return;
  }

  if (visiblePending.length === 0 && visibleRecords.length === 0) {
    maintenanceList.innerHTML = '<p class="empty-state">No maintenance items match your search.</p>';
    return;
  }

  const pendingSection = visiblePending.length === 0 ? `
    <div class="maintenance-table">
      <div class="maintenance-header-clean">
        <span>Priority</span>
        <span>Machine</span>
        <span>Filter</span>
        <span>Type</span>
        <span>Reason</span>
        <span>Action</span>
      </div>
      <div class="maintenance-row">
        <span>—</span>
        <span class="maintenance-machine-name">No pending items</span>
        <span>—</span>
        <span>—</span>
        <span class="maintenance-notes-cell">All filters are currently healthy.</span>
        <span>—</span>
      </div>
    </div>
  ` : `
    <div class="maintenance-table">
      <div class="maintenance-header-clean">
        <span>Priority</span>
        <span>Machine</span>
        <span>Filter</span>
        <span>Type</span>
        <span>Reason</span>
        <span>Action</span>
      </div>

      ${visiblePending.map(item => {
        const statusClass = item.operational.type === 'critical' ? 'critical' : 'review';
        const actionLabel = item.operational.type === 'critical' ? 'Critical Inspection' : 'Warning Review';

        return `
          <div class="maintenance-row">
            <span>
              <span class="maintenance-pill maintenance-${statusClass}">${item.operational.status}</span>
            </span>
            <span class="maintenance-machine-name">${item.machine ? item.machine.name : 'Unknown Machine'}</span>
            <span class="maintenance-filter-name">${item.filter.productName || 'N/A'}</span>
            <span>${actionLabel}</span>
            <span class="maintenance-notes-cell">${item.operational.reason}</span>
            <span>
              <button type="button" class="filter-action-btn filter-maintenance-btn" onclick="startMaintenanceFromFilter(${item.filter.id})">
                Log Maintenance
              </button>
            </span>
          </div>
        `;
      }).join('')}
    </div>
  `;

  const historySection = visibleRecords.length === 0 ? `
    <p class="empty-state">No maintenance history yet.</p>
  ` : `
    <div class="maintenance-table">
      <div class="maintenance-header-clean maintenance-history-header-clean">
        <span>Date</span>
        <span>Machine</span>
        <span>Filter</span>
        <span>Type</span>
        <span>Notes</span>
        <span>Status</span>
      </div>

      ${visibleRecords.map(record => {
        const machine = machines.find(machine => machine.id === record.machineId);
        const filter = filters.find(filter => filter.id === record.filterId);
        const typeStatus = getMaintenanceTypeStatus(record.type);
        const dateText = record.date ? new Date(record.date).toLocaleDateString() : 'Not recorded';

        return `
          <div class="maintenance-row">
            <span>${dateText}</span>
            <span class="maintenance-machine-name">${machine ? machine.name : 'Unknown Machine'}</span>
            <span class="maintenance-filter-name">${filter ? filter.productName : 'Not assigned'}</span>
            <span>${record.type || 'General'}</span>
            <span class="maintenance-notes-cell">${record.notes || 'No notes'}</span>
            <span>
              <span class="maintenance-pill maintenance-${typeStatus.type}">${typeStatus.label}</span>
            </span>
          </div>
        `;
      }).join('')}
    </div>
  `;

  maintenanceList.innerHTML = `
    <div class="maintenance-stack">
      <div class="maintenance-block">
        <div class="panel-heading panel-heading-clean">
          <h3>⚠️ Pending Maintenance</h3>
          <p>Filters currently in Watch or Critical status that need attention.</p>
        </div>
        ${pendingSection}
      </div>

      <div class="maintenance-block">
        <div class="panel-heading panel-heading-clean">
          <h3>📋 Maintenance History</h3>
          <p>Actions already logged in the system.</p>
        </div>
        ${historySection}
      </div>
    </div>
  `;
}


function generateMaintenanceReport() {
  if (!maintenanceReportOutputCard || !maintenanceReportOutput) return;

  const pendingMaintenance = getPendingMaintenanceItems();

  const warningReviews = maintenanceRecords.filter(record => {
    const typeStatus = getMaintenanceTypeStatus(record.type);
    return typeStatus.type === 'review';
  }).length;

  const criticalInspections = maintenanceRecords.filter(record => {
    const typeStatus = getMaintenanceTypeStatus(record.type);
    return typeStatus.type === 'critical';
  }).length;

  const replacements = maintenanceRecords.filter(record => {
    const typeStatus = getMaintenanceTypeStatus(record.type);
    return typeStatus.type === 'replacement';
  }).length;

  const psiCorrections = maintenanceRecords.filter(record => record.correctedPsi !== null && record.correctedPsi !== undefined).length;

  const pendingRows = pendingMaintenance.length === 0 ? `
    <tr>
      <td colspan="6">No pending maintenance. All filters are currently healthy.</td>
    </tr>
  ` : pendingMaintenance.map(item => {
    const currentPsi = item.filter.psi || item.filter.psi === 0 ? `${item.filter.psi} PSI` : 'No PSI recorded';
    const action = item.operational.type === 'critical' ? 'Inspect immediately / prepare replacement' : 'Review and correct PSI';

    return `
      <tr>
        <td>${item.operational.status}</td>
        <td>${item.machine ? item.machine.name : 'Unknown Machine'}</td>
        <td>${item.filter.productName || 'N/A'}</td>
        <td>${currentPsi}</td>
        <td>${item.operational.reason}</td>
        <td>${action}</td>
      </tr>
    `;
  }).join('');

  const historyRows = maintenanceRecords.length === 0 ? `
    <tr>
      <td colspan="8">No maintenance history recorded yet.</td>
    </tr>
  ` : maintenanceRecords.slice().reverse().map(record => {
    const machine = machines.find(machine => machine.id === record.machineId);
    const filter = filters.find(filter => filter.id === record.filterId);
    const dateText = record.date ? new Date(record.date).toLocaleDateString() : 'Not recorded';
    const psiText = record.correctedPsi !== null && record.correctedPsi !== undefined
      ? `${record.previousPsi !== null && record.previousPsi !== undefined ? record.previousPsi : 'N/A'} → ${record.correctedPsi}`
      : 'N/A';
    const replacementText = record.replacedWith
      ? `${record.replacedFrom || 'Unknown'} → ${record.replacedWith}`
      : 'N/A';

    return `
      <tr>
        <td>${dateText}</td>
        <td>${machine ? machine.name : 'Unknown Machine'}</td>
        <td>${filter ? filter.productName : 'Not assigned'}</td>
        <td>${record.type || 'General'}</td>
        <td>${psiText}</td>
        <td>${replacementText}</td>
        <td>${record.notes || 'No notes'}</td>
        <td>${getMaintenanceTypeStatus(record.type).label}</td>
      </tr>
    `;
  }).join('');

  maintenanceReportOutput.innerHTML = `
    <div class="maintenance-report-summary">
      <h4>FiltraCore Maintenance Report</h4>
      <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
      <div class="maintenance-report-metrics">
        <div><span>Total Records</span><strong>${maintenanceRecords.length}</strong></div>
        <div><span>Warning Reviews</span><strong>${warningReviews}</strong></div>
        <div><span>Critical Inspections</span><strong>${criticalInspections}</strong></div>
        <div><span>Filter Replacements</span><strong>${replacements}</strong></div>
        <div><span>PSI Corrections</span><strong>${psiCorrections}</strong></div>
        <div><span>Pending Items</span><strong>${pendingMaintenance.length}</strong></div>
      </div>
    </div>

    <div class="maintenance-report-section">
      <h4>Pending Maintenance</h4>
      <table class="maintenance-report-table">
        <thead>
          <tr>
            <th>Priority</th>
            <th>Machine</th>
            <th>Filter</th>
            <th>Current PSI</th>
            <th>Reason</th>
            <th>Recommended Action</th>
          </tr>
        </thead>
        <tbody>${pendingRows}</tbody>
      </table>
    </div>

    <div class="maintenance-report-section">
      <h4>Maintenance History</h4>
      <table class="maintenance-report-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Machine</th>
            <th>Filter</th>
            <th>Type</th>
            <th>PSI Change</th>
            <th>Replacement</th>
            <th>Notes</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${historyRows}</tbody>
      </table>
    </div>
  `;

  maintenanceReportOutputCard.style.display = 'block';
  if (closeMaintenanceReportBtn) {
    closeMaintenanceReportBtn.style.display = 'inline-block';
  }
  maintenanceReportOutputCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

if (maintenanceSearchInput) {
  maintenanceSearchInput.addEventListener('input', () => {
    renderMaintenance();
  });
}

if (generateMaintenanceReportBtn) {
  generateMaintenanceReportBtn.addEventListener('click', generateMaintenanceReport);
}

if (printMaintenanceReportBtn) {
  printMaintenanceReportBtn.addEventListener('click', () => {
    generateMaintenanceReport();
    window.print();
  });
}

if (closeMaintenanceReportBtn) {
  closeMaintenanceReportBtn.addEventListener('click', () => {
    if (maintenanceReportOutputCard) {
      maintenanceReportOutputCard.style.display = 'none';
    }

    closeMaintenanceReportBtn.style.display = 'none';
  });
}

function getReorderAlerts() {
  const alerts = [];

  inventory.forEach(item => {
    const stock = Number(item.stock) || 0;
    const reorderLevel = Number(item.reorderLevel) || 0;

    if (stock <= reorderLevel) {
      alerts.push({
        type: 'warning',
        machine: 'Inventory',
        message: `${item.name} low stock (${stock} left). Reorder level is ${reorderLevel}.`
      });
    }
  });

  getInventoryPredictions().forEach(item => {
    if (item.coverageMonths !== null && item.coverageMonths <= 1) {
      alerts.push({
        type: 'critical',
        machine: 'Inventory Prediction',
        message: `${item.productName} has only ${item.coverageMonths.toFixed(1)} months of stock coverage. Recommended action: reorder immediately.`
      });
    } else if (item.coverageMonths !== null && item.coverageMonths <= 3) {
      alerts.push({
        type: 'warning',
        machine: 'Inventory Prediction',
        message: `${item.productName} has ${item.coverageMonths.toFixed(1)} months of stock coverage. Recommended action: plan reorder soon.`
      });
    } else if (item.coverageMonths !== null && item.coverageMonths <= 6) {
      alerts.push({
        type: 'warning',
        machine: 'Inventory Prediction',
        message: `${item.productName} has ${item.coverageMonths.toFixed(1)} months of stock coverage. Recommended action: monitor monthly consumption.`
      });
    }
  });

  return alerts;
}

function getSystemAlerts() {
  const alerts = [];

  machines.forEach(machine => {
    const machineFilters = filters.filter(filter => filter.machineId === machine.id);

    if (machineFilters.length === 0) {
      alerts.push({
        type: 'critical',
        machine: machine.name,
        message: 'No filters assigned. Machine is unprotected.'
      });
      return;
    }

    machineFilters.forEach(filter => {
      const status = getFilterStatus(filter);
      const psiStatus = getPsiStatus(filter.psi);
      const psiTrend = getPsiTrend(filter.psiHistory);
      const psiPrediction = getPsiFailurePrediction(filter.psiHistory);

      let finalType = 'healthy';
      const messages = [];

      if (status === 'Expired' || status === 'Critical' || psiStatus.type === 'critical' || psiPrediction.type === 'critical') {
        finalType = 'critical';
      } else if (status === 'Due Soon' || psiStatus.type === 'warning' || psiTrend.type === 'warning' || psiPrediction.type === 'warning') {
        finalType = 'warning';
      }

      if (filter.productName) {
        messages.push(`Filter: ${filter.productName}`);
      }

      if (status !== 'Active') {
        messages.push(`Lifecycle: ${status}`);
      }

      if (filter.psi || filter.psi === 0) {
        messages.push(`Current PSI: ${filter.psi}`);
      }

      if (psiStatus.status !== 'Healthy' && psiStatus.status !== 'Not recorded') {
        messages.push(`PSI Status: ${psiStatus.status}`);
      }

      if (psiTrend.trend === 'Dropping' || psiTrend.trend === 'Increasing') {
        messages.push(`Trend: ${psiTrend.trend}`);
      }

      if (psiPrediction.prediction !== 'Stable' && psiPrediction.prediction !== 'No prediction') {
        messages.push(`Prediction: ${psiPrediction.prediction}`);
      }

      if (finalType === 'healthy') {
        return;
      }

      let finalMessage = messages.join(' | ');

      if (finalType === 'critical') {
        finalMessage += '. Recommended action: inspect immediately and prepare replacement.';
      } else if (finalType === 'warning') {
        finalMessage += '. Recommended action: monitor and schedule maintenance.';
      }

      alerts.push({
        type: finalType,
        machine: machine.name,
        message: finalMessage
      });
    });
  });

  return alerts;
}

function getMachineRiskModel(machineName) {
  const machine = machines.find(machine => machine.name === machineName);
  const type = String(machine?.type || '').toLowerCase();

  const models = {
    ice: {
      warning: {
        labor: 35,
        operational: 40,
        equipment: 25
      },
      critical: {
        labor: 70,
        operational: 120,
        equipment: 80
      },
      reason: 'Ice equipment has higher operational impact because loss of ice can affect beverage service, food holding, and guest operations.'
    },
    coffee: {
      warning: {
        labor: 25,
        operational: 30,
        equipment: 20
      },
      critical: {
        labor: 60,
        operational: 80,
        equipment: 50
      },
      reason: 'Coffee equipment risk is based on service disruption, taste and water quality issues, and possible equipment scaling.'
    },
    soda: {
      warning: {
        labor: 30,
        operational: 45,
        equipment: 25
      },
      critical: {
        labor: 65,
        operational: 110,
        equipment: 70
      },
      reason: 'Soda systems affect beverage service, water quality, carbonation consistency, and guest-facing operations.'
    },
    refrigeration: {
      warning: {
        labor: 40,
        operational: 60,
        equipment: 40
      },
      critical: {
        labor: 90,
        operational: 180,
        equipment: 120
      },
      reason: 'Refrigeration has higher risk because failure can affect food safety, product loss, and operational compliance.'
    },
    water: {
      warning: {
        labor: 25,
        operational: 35,
        equipment: 20
      },
      critical: {
        labor: 55,
        operational: 90,
        equipment: 55
      },
      reason: 'Water systems affect service quality, filtration reliability, and downstream equipment protection.'
    },
    default: {
      warning: {
        labor: 25,
        operational: 25,
        equipment: 15
      },
      critical: {
        labor: 50,
        operational: 60,
        equipment: 40
      },
      reason: 'General filter risk is based on inspection labor, maintenance planning, and possible equipment stress.'
    }
  };

  if (type.includes('ice')) return models.ice;
  if (type.includes('coffee')) return models.coffee;
  if (type.includes('soda')) return models.soda;
  if (type.includes('refrigeration')) return models.refrigeration;
  if (type.includes('water')) return models.water;

  return models.default;
}

function getFinancialRisk() {
  const alerts = getSystemAlerts();

  let total = 0;
  const reasons = [];

  alerts.forEach(alert => {
    const model = getMachineRiskModel(alert.machine);
    const components = alert.type === 'critical' ? model.critical : model.warning;
    const cost = components.labor + components.operational + components.equipment;

    total += cost;

    reasons.push({
      machine: alert.machine,
      type: alert.type,
      cost,
      message: alert.message,
      costReason: `${model.reason} Breakdown: labor $${components.labor}, operational impact $${components.operational}, equipment risk $${components.equipment}.`
    });
  });

  return {
    total,
    reasons
  };
}

function getPotentialSavings() {
  return getFinancialRisk().total;
}

function renderFinancialMetrics() {
  const riskData = getFinancialRisk();
  const risk = riskData.total;
  const savings = getPotentialSavings();

  if (riskExposureEl) {
    riskExposureEl.textContent = `$${risk.toFixed(2)}`;
  }

  if (savingsEl) {
    savingsEl.textContent = `$${savings.toFixed(2)}`;
  }
}

function getAlertKey(alert) {
  return `${alert.type}|${alert.machine}|${alert.message}`;
}

function getAllAlerts() {
  return [...getSystemAlerts(), ...getReorderAlerts()];
}

function getVisibleAlerts() {
  return getAllAlerts().filter(alert => !archivedAlerts.includes(getAlertKey(alert)));
}

function archiveAlert(alertKey) {
  if (!archivedAlerts.includes(alertKey)) {
    archivedAlerts.push(alertKey);
  }

  localStorage.setItem('filtracore_archivedAlerts', JSON.stringify(archivedAlerts));
  renderRiskScore();
  renderFinancialMetrics();
  renderAlertsModal();
}

function archiveAllVisibleAlerts() {
  getVisibleAlerts().forEach(alert => {
    const key = getAlertKey(alert);

    if (!archivedAlerts.includes(key)) {
      archivedAlerts.push(key);
    }
  });

  localStorage.setItem('filtracore_archivedAlerts', JSON.stringify(archivedAlerts));
  renderRiskScore();
  renderFinancialMetrics();
  renderAlertsModal();
}

function renderAlertsModal() {
  if (!modalAlertsList) return;

  const alerts = getVisibleAlerts();
  const criticalCount = alerts.filter(alert => alert.type === 'critical').length;
  const warningCount = alerts.filter(alert => alert.type === 'warning').length;
  const riskData = getFinancialRisk();
  const risk = riskData.total;

  if (modalAlertCount) modalAlertCount.textContent = alerts.length;
  if (modalCriticalCount) modalCriticalCount.textContent = criticalCount;
  if (modalWarningCount) modalWarningCount.textContent = warningCount;
  if (modalRiskExposure) modalRiskExposure.textContent = `$${risk.toFixed(2)}`;

  if (alerts.length === 0) {
    modalAlertsList.innerHTML = '<p class="empty-state">All systems operational.</p>';
    return;
  }

  alerts.sort((a, b) => {
    const priority = {
      critical: 1,
      warning: 2
    };

    return priority[a.type] - priority[b.type];
  });

    modalAlertsList.innerHTML = alerts.map(alert => {
      const alertKey = getAlertKey(alert);
      const safeAlertKey = alertKey.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const riskReason = riskData.reasons.find(reason => getAlertKey(reason) === alertKey);

      return `
        <div class="modal-alert-card alert-${alert.type}">
          <div class="alert-card-header">
            <div>
              <h3>${alert.machine}</h3>
              <p><strong>${alert.type.toUpperCase()}</strong></p>
            </div>

            <div class="alert-actions">
              <button type="button" class="view-machine-btn" onclick="goToMachine('${String(alert.machine).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')">
                View Machine
              </button>
              <button type="button" class="start-maintenance-btn" onclick="startMaintenanceFromAlert('${String(alert.machine).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}', '${String(alert.type).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}', '${String(alert.message).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')">
                Start Maintenance
              </button>
              <button type="button" class="archive-alert-btn" onclick="archiveAlert('${safeAlertKey}')">
                Archive
              </button>
            </div>
          </div>
          <p>${alert.message}</p>
          ${riskReason ? `
            <div class="risk-breakdown">
              <p><strong>Risk Exposure:</strong> $${riskReason.cost.toFixed(2)}</p>
              <p><strong>Why this amount?</strong> ${riskReason.costReason}</p>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
}

function openAlertsModal() {
  if (!alertsModal) return;

  renderRiskScore();
  renderFinancialMetrics();
  renderAlertsModal();
  alertsModal.classList.add('is-open');
  alertsModal.setAttribute('aria-hidden', 'false');
}

function closeAlertsModalWindow() {
  if (!alertsModal) return;

  alertsModal.classList.remove('is-open');
  alertsModal.setAttribute('aria-hidden', 'true');
}

function goToMachine(machineName) {
  closeAlertsModalWindow();
  showSection('machines');
  setActiveNavById('machines');

  if (machineSearchInput) {
    machineSearchInput.value = machineName;
    renderMachines();
    machineSearchInput.focus();
  }

  const machinesSection = document.querySelector('#machines');
  if (machinesSection) {
    machinesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function startMaintenanceFromAlert(machineName, alertType, alertMessage) {
  closeAlertsModalWindow();
  showSection('maintenance');
  setActiveNavById('maintenance');
  updateMaintenanceOptions();

  const machine = machines.find(machine => machine.name === machineName);
  const machineFilters = machine ? filters.filter(filter => filter.machineId === machine.id) : [];
  const latestFilter = machineFilters.length > 0 ? machineFilters[machineFilters.length - 1] : null;
  const today = new Date().toISOString().split('T')[0];

  if (maintenanceMachineSelect && machine) {
    maintenanceMachineSelect.value = String(machine.id);
  }

  if (maintenanceFilterSelect && latestFilter) {
    maintenanceFilterSelect.value = String(latestFilter.id);
  }
  updateMaintenancePsiPreview();

  const maintenanceTypeInput = document.querySelector('#maintenance-type');
  const maintenanceDateInput = document.querySelector('#maintenance-date');
  const maintenanceNotesInput = document.querySelector('#maintenance-notes');

  if (maintenanceTypeInput) {
    maintenanceTypeInput.value = alertType === 'critical' ? 'Critical Inspection' : 'Warning Review';
  }

  if (maintenanceDateInput) {
    maintenanceDateInput.value = today;
  }

  if (maintenanceNotesInput) {
    maintenanceNotesInput.value = `Alert from Intelligence Report: ${alertMessage}`;
  }

  const maintenanceSection = document.querySelector('#maintenance');
  if (maintenanceSection) {
    maintenanceSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function openManualModal() {
  if (!manualModal) return;

  manualModal.classList.add('is-open');
  manualModal.setAttribute('aria-hidden', 'false');
}

function closeManualModalWindow() {
  if (!manualModal) return;

  manualModal.classList.remove('is-open');
  manualModal.setAttribute('aria-hidden', 'true');
}

function getSystemHealth() {
  if (machines.length === 0) return 100;

  const alerts = getVisibleAlerts();
  let score = 100;

  alerts.forEach(alert => {
    if (alert.type === 'critical') score -= 25;
    if (alert.type === 'warning') score -= 10;
  });

  if (score < 0) score = 0;

  return score;
}

function renderRiskScore() {
  const healthEl = document.querySelector('#system-health');
  const alerts = getVisibleAlerts();

  const criticalCount = alerts.filter(alert => alert.type === 'critical').length;
  const warningCount = alerts.filter(alert => alert.type === 'warning').length;

  if (alertCountEl) {
    alertCountEl.textContent = alerts.length;
  }

  if (dashboardAlertsCount) {
    dashboardAlertsCount.textContent = alerts.length;
  }

  if (alertSummaryEl) {
    alertSummaryEl.textContent = alerts.length === 0
      ? 'All systems operational'
      : `${criticalCount} critical / ${warningCount} warning`;
  }

  if (healthEl) {
    const health = getSystemHealth();
    healthEl.textContent = `System Health: ${health}%`;

    healthEl.classList.remove('health-good', 'health-warning', 'health-critical');

    if (health >= 80) {
      healthEl.classList.add('health-good');
    } else if (health >= 50) {
      healthEl.classList.add('health-warning');
    } else {
      healthEl.classList.add('health-critical');
    }
  }

  if (!riskList) return;

  if (machines.length === 0) {
    riskList.classList.remove('alerts-collapsed');
    riskList.innerHTML = '<p class="empty-state">No machines registered yet.</p>';
    return;
  }

  if (alerts.length === 0) {
    riskList.classList.remove('alerts-collapsed');
    riskList.innerHTML = '<p class="empty-state">All systems operational.</p>';
    return;
  }

  if (!alertsExpanded) {
    riskList.classList.add('alerts-collapsed');
    riskList.innerHTML = `<p class="empty-state">${alerts.length} active alerts. Use Show Alerts to review them.</p>`;
    return;
  }

  riskList.classList.remove('alerts-collapsed');

  alerts.sort((a, b) => {
    const priority = {
      critical: 1,
      warning: 2
    };

    return priority[a.type] - priority[b.type];
  });

  riskList.innerHTML = alerts.map(alert => {
    const alertKey = getAlertKey(alert);
    const safeAlertKey = alertKey.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    return `
      <div class="machine-card alert-${alert.type}">
        <div class="alert-card-header">
          <div>
            <h3>${alert.machine}</h3>
            <p><strong>${alert.type.toUpperCase()}</strong></p>
          </div>
          <button type="button" class="archive-alert-btn" onclick="archiveAlert('${safeAlertKey}')">Archive</button>
        </div>
        <p>${alert.message}</p>
      </div>
    `;
  }).join('');
}

links.forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();

    // remove active from all
    links.forEach(l => l.classList.remove('active'));

    // add active to clicked
    link.classList.add('active');

    const id = link.getAttribute('href').replace('#', '');
    showSection(id);
  });
});

if (machineForm) {
  machineForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const machine = {
      id: Date.now(),
      name: document.querySelector('#machine-name').value,
      type: document.querySelector('#machine-type').value,
      location: document.querySelector('#machine-location').value
    };

    machines.push(machine);
    localStorage.setItem('filtracore_machines', JSON.stringify(machines));
    machineForm.reset();
    renderMachines();
    updateMachineOptions();
    updateMaintenanceOptions();
    renderMaintenance();
    renderRiskScore();
    renderFinancialMetrics();
    renderReports();
  });
}

if (filterForm) {
  filterForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const machineId = Number(document.querySelector('#filter-machine').value);
    const productId = Number(document.querySelector('#filter-product').value);
    const product = inventory.find(item => item.id === productId);
    const psiInput = document.querySelector('#filter-psi');
    const psi = psiInput && psiInput.value !== '' ? Number(psiInput.value) : null;

    if (!machineId) {
      alert('Select a valid machine');
      return;
    }

    if (!product) {
      alert('Select a valid filter product');
      return;
    }

    if (Number(product.stock) <= 0) {
      alert('No stock available for this filter product');
      return;
    }

    product.stock = Number(product.stock) - 1;

    const installedAt = new Date();
    const lifeMonths = Number(product.lifeMonths || getDefaultLifeMonths(product.category));
    const dueDate = addMonths(installedAt, lifeMonths);

    const filter = {
      id: Date.now(),
      machineId,
      productId: product.id,
      productName: product.name,
      cost: Number(product.unitCost || 0),
      lifeMonths,
      psi,
      psiHistory: psi !== null ? [
        {
          date: new Date().toISOString(),
          psi
        }
      ] : [],
      installedAt: installedAt.toISOString(),
      dueDate: dueDate.toISOString()
    };

    filters.push(filter);
    localStorage.setItem('filtracore_filters', JSON.stringify(filters));
    localStorage.setItem('filtracore_inventory', JSON.stringify(inventory));
    filterForm.reset();
    renderMachines();
    renderFilters();
    renderInventory();
    updateInventoryOptions();
    updateMaintenanceOptions();
    renderMaintenance();
    renderCostMetrics();
    renderCostPerMachine();
    renderRiskScore();
    renderFinancialMetrics();
    renderReports();
  });
}

if (inventoryForm) {
  inventoryForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const category = document.querySelector('#inventory-category').value;

    const item = {
      id: Date.now(),
      name: document.querySelector('#inventory-name').value,
      category,
      stock: Number(document.querySelector('#inventory-stock').value),
      unitCost: Number(document.querySelector('#inventory-cost').value),
      reorderLevel: Number(document.querySelector('#inventory-reorder').value),
      lifeMonths: getDefaultLifeMonths(category)
    };

    inventory.push(item);
    localStorage.setItem('filtracore_inventory', JSON.stringify(inventory));
    inventoryForm.reset();
    renderInventory();
    updateInventoryOptions();
    renderCostPerMachine();
    renderRiskScore();
    renderFinancialMetrics();
    renderReports();
    console.log('Inventory item saved:', item);
  });
}

if (maintenanceForm) {
  maintenanceForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const machineId = Number(document.querySelector('#maintenance-machine').value);
    const filterId = Number(document.querySelector('#maintenance-filter').value) || null;
    const type = document.querySelector('#maintenance-type').value;
    const date = document.querySelector('#maintenance-date').value;
    const notes = document.querySelector('#maintenance-notes').value;
    const replacementProductId = Number(document.querySelector('#maintenance-replacement-product')?.value) || null;
    const correctedPsiInput = document.querySelector('#maintenance-corrected-psi');
    const correctedPsi = correctedPsiInput && correctedPsiInput.value !== '' ? Number(correctedPsiInput.value) : null;
    const isReplacement = type.toLowerCase().includes('replace');

    if (!machineId) {
      alert('Select a valid machine');
      return;
    }

    if (!type || !date) {
      alert('Complete maintenance type and date');
      return;
    }

    if (isReplacement && !filterId) {
      alert('Select the current filter you are replacing');
      return;
    }

    if (isReplacement && !replacementProductId) {
      alert('Select the replacement filter product');
      return;
    }

    const record = {
      id: Date.now(),
      machineId,
      filterId,
      type,
      date,
      notes,
      replacementProductId,
      correctedPsi,
      createdAt: new Date().toISOString()
    };

    if (isReplacement) {
      const filter = filters.find(filter => filter.id === filterId);
      const replacementProduct = inventory.find(item => item.id === replacementProductId);

      if (!filter) {
        alert('Current filter not found');
        return;
      }

      if (!replacementProduct) {
        alert('Replacement product not found');
        return;
      }

      if (Number(replacementProduct.stock) <= 0) {
        alert('No stock available for the selected replacement filter');
        return;
      }

      replacementProduct.stock = Number(replacementProduct.stock) - 1;

      const replacementDate = date ? new Date(date) : new Date();
      const lifeMonths = Number(replacementProduct.lifeMonths || getDefaultLifeMonths(replacementProduct.category));
      const newDueDate = addMonths(replacementDate, lifeMonths);

      record.replacedFrom = filter.productName || 'Unknown filter';
      record.replacedWith = replacementProduct.name;

      filter.productId = replacementProduct.id;
      filter.productName = replacementProduct.name;
      filter.cost = Number(replacementProduct.unitCost || 0);
      filter.lifeMonths = lifeMonths;
      filter.installedAt = replacementDate.toISOString();
      filter.dueDate = newDueDate.toISOString();
      filter.psi = null;
      filter.psiHistory = [];

      localStorage.setItem('filtracore_filters', JSON.stringify(filters));
      localStorage.setItem('filtracore_inventory', JSON.stringify(inventory));
    }

    if (!isReplacement && correctedPsi !== null) {
      if (!filterId) {
        alert('Select a filter before entering corrected PSI');
        return;
      }

      const filter = filters.find(filter => filter.id === filterId);

      if (!filter) {
        alert('Filter not found for PSI correction');
        return;
      }

      record.previousPsi = filter.psi || filter.psi === 0 ? filter.psi : null;
      filter.psi = correctedPsi;

      if (!Array.isArray(filter.psiHistory)) {
        filter.psiHistory = [];
      }

      filter.psiHistory.push({
        date: date ? new Date(date).toISOString() : new Date().toISOString(),
        psi: correctedPsi,
        source: 'maintenance'
      });

      localStorage.setItem('filtracore_filters', JSON.stringify(filters));
    }

    if (isReplacement && correctedPsi !== null && filterId) {
      const filter = filters.find(filter => filter.id === filterId);

      if (filter) {
        filter.psi = correctedPsi;
        filter.psiHistory = [
          {
            date: date ? new Date(date).toISOString() : new Date().toISOString(),
            psi: correctedPsi,
            source: 'replacement'
          }
        ];

        localStorage.setItem('filtracore_filters', JSON.stringify(filters));
      }
    }

    maintenanceRecords.push(record);
    localStorage.setItem('filtracore_maintenance', JSON.stringify(maintenanceRecords));
    maintenanceForm.reset();
    updateMaintenancePsiPreview();
    updateMaintenanceOptions();
    renderMaintenance();
    renderFilters();
    renderCostMetrics();
    renderCostPerMachine();
    renderRiskScore();
    renderFinancialMetrics();
    renderReports();
    renderMachines();
    renderInventory();
    generateMaintenanceReport();
  });
}

const setActiveNavById = (id) => {
  links.forEach(link => {
    const linkId = link.getAttribute('href').replace('#', '');
    link.classList.toggle('active', linkId === id);
  });
};

function openMachinesSection() {
  showSection('machines');
  setActiveNavById('machines');
  const machinesSection = document.querySelector('#machines');
  if (machinesSection) machinesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openFiltersSection() {
  updateMachineOptions();
  updateInventoryOptions();
  updateMaintenanceOptions();

  showSection('filters');
  setActiveNavById('filters');

  const filtersSection = document.querySelector('#filters');
  if (filtersSection) {
    filtersSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

const addMachineBtn = document.querySelector('#add-machine');

if (addMachineBtn) {
  addMachineBtn.addEventListener('click', openMachinesSection);
}

const addFilterBtn = document.querySelector('#add-filter');

if (addFilterBtn) {
  addFilterBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    openFiltersSection();
  };
}

document.addEventListener('click', (e) => {
  const machineButton = e.target.closest('#add-machine');
  const filterButton = e.target.closest('#add-filter');

  if (machineButton) {
    e.preventDefault();
    e.stopPropagation();
    openMachinesSection();
  }

  if (filterButton) {
    e.preventDefault();
    e.stopPropagation();
    openFiltersSection();
  }
}, true);

if (toggleAlertsBtn) {
  toggleAlertsBtn.addEventListener('click', () => {
    alertsExpanded = !alertsExpanded;
    toggleAlertsBtn.textContent = alertsExpanded ? 'Hide Alerts' : 'Show Alerts';
    renderRiskScore();
  });
}

if (archiveAllAlertsBtn) {
  archiveAllAlertsBtn.addEventListener('click', () => {
    archiveAllVisibleAlerts();
  });
}

if (openAlertsCard) {
  openAlertsCard.addEventListener('click', () => {
    openAlertsModal();
  });
}

if (closeAlertsModal) {
  closeAlertsModal.addEventListener('click', () => {
    closeAlertsModalWindow();
  });
}

if (closeAlertsModalFooter) {
  closeAlertsModalFooter.addEventListener('click', () => {
    closeAlertsModalWindow();
  });
}

if (alertsModal) {
  alertsModal.addEventListener('click', (e) => {
    if (e.target === alertsModal) {
      closeAlertsModalWindow();
    }
  });
}

if (archiveAllModalAlerts) {
  archiveAllModalAlerts.addEventListener('click', () => {
    archiveAllVisibleAlerts();
  });
}

if (openManualCard) {
  openManualCard.addEventListener('click', () => {
    openManualModal();
  });
}

if (closeManualModal) {
  closeManualModal.addEventListener('click', () => {
    closeManualModalWindow();
  });
}

if (closeManualModalFooter) {
  closeManualModalFooter.addEventListener('click', () => {
    closeManualModalWindow();
  });
}

if (manualModal) {
  manualModal.addEventListener('click', (e) => {
    if (e.target === manualModal) {
      closeManualModalWindow();
    }
  });
}

// default view
showSection('dashboard');
renderMachines();
updateMachineOptions();
updateInventoryOptions();
updateMaintenanceOptions();
renderFilters();
renderInventory();
renderMaintenance();
renderCostMetrics();
renderCostPerMachine();
renderRiskScore();
renderFinancialMetrics();
renderReports();