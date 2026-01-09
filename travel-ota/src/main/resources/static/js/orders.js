// Global variables
let currentOrder = null;
let selectedBaggageType = null;
let selectedBaggagePrice = 0;

// Search order form submission
document.getElementById('searchOrderForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const confirmationNumber = document.getElementById('confirmationNumber').value.trim();
    const passengerLastName = document.getElementById('passengerLastName').value.trim();
    
    if (!confirmationNumber || !passengerLastName) {
        showAlert('danger', 'Please enter both confirmation number and passenger last name');
        return;
    }
    
    try {
        const response = await fetch('/api/flights/orders/query', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                confirmationNumber: confirmationNumber,
                passengerLastName: passengerLastName
            })
        });
        
        if (response.ok) {
            currentOrder = await response.json();
            displayOrder(currentOrder);
        } else {
            const error = await response.json();
            showAlert('danger', error.message || 'Order not found. Please check your confirmation number and last name.');
        }
    } catch (error) {
        console.error('Error searching order:', error);
        showAlert('danger', 'Failed to search order. Please try again.');
    }
});

// Display order details
function displayOrder(order) {
    document.getElementById('orderContainer').style.display = 'block';
    document.getElementById('orderConfirmation').textContent = order.confirmationNumber;
    
    // Set status badge
    const statusBadge = document.getElementById('orderStatus');
    statusBadge.textContent = order.status;
    statusBadge.className = 'status-badge';
    
    if (order.status === 'CONFIRMED') {
        statusBadge.classList.add('status-confirmed');
    } else if (order.status === 'CANCELLED') {
        statusBadge.classList.add('status-cancelled');
    } else if (order.status === 'CHANGED') {
        statusBadge.classList.add('status-changed');
    }
    
    // Display flight information
    displayFlightInfo(order.flightInfo);
    
    // Display passenger information
    displayPassengerInfo(order.passengers);
    
    // Display payment information
    displayPaymentInfo(order.paymentInfo);
    
    // Display action buttons
    displayActionButtons(order.status);
    
    // Populate passenger dropdown for baggage modal
    populatePassengerDropdown(order.passengers);
    
    // Scroll to order container
    document.getElementById('orderContainer').scrollIntoView({ behavior: 'smooth' });
}

// Display flight information
function displayFlightInfo(flightInfo) {
    const container = document.getElementById('flightInfo');
    
    const departureTime = new Date(flightInfo.departureTime);
    const arrivalTime = new Date(flightInfo.arrivalTime);
    
    container.innerHTML = `
        <div class="flight-route">
            <div class="city-info">
                <h4>${flightInfo.departureCity}</h4>
                <p class="text-muted mb-0">${flightInfo.departureAirport}</p>
                <p class="mb-0"><strong>${departureTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</strong></p>
                <p class="text-muted small">${departureTime.toLocaleDateString()}</p>
            </div>
            <div class="flight-arrow">
                <i class="fas fa-plane fa-2x"></i>
                <p class="text-muted small mb-0">${flightInfo.flightNumber}</p>
            </div>
            <div class="city-info">
                <h4>${flightInfo.arrivalCity}</h4>
                <p class="text-muted mb-0">${flightInfo.arrivalAirport}</p>
                <p class="mb-0"><strong>${arrivalTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</strong></p>
                <p class="text-muted small">${arrivalTime.toLocaleDateString()}</p>
            </div>
        </div>
        <div class="row mt-3">
            <div class="col-md-6">
                <p class="mb-1"><i class="fas fa-ticket-alt text-primary"></i> <strong>Flight Number:</strong> ${flightInfo.flightNumber}</p>
                <p class="mb-1"><i class="fas fa-chair text-primary"></i> <strong>Cabin Class:</strong> ${flightInfo.cabinClass}</p>
            </div>
        </div>
    `;
}

// Display passenger information
function displayPassengerInfo(passengers) {
    const container = document.getElementById('passengerInfo');
    
    container.innerHTML = passengers.map(passenger => `
        <div class="passenger-card">
            <div class="row">
                <div class="col-md-4">
                    <p class="mb-1"><strong>Name:</strong> ${passenger.firstName} ${passenger.lastName}</p>
                    <p class="mb-0 text-muted small">Type: ${passenger.passengerType}</p>
                </div>
                <div class="col-md-4">
                    <p class="mb-1"><strong>Document:</strong> ${passenger.documentType}</p>
                    <p class="mb-0 text-muted small">${passenger.documentNumber}</p>
                </div>
                <div class="col-md-4">
                    <p class="mb-1"><strong>Seat:</strong> ${passenger.seatNumber || 'Not assigned'}</p>
                    <p class="mb-0 text-muted small">Passenger ID: ${passenger.passengerId}</p>
                </div>
            </div>
        </div>
    `).join('');
}

// Display payment information
function displayPaymentInfo(paymentInfo) {
    const container = document.getElementById('paymentInfo');
    
    container.innerHTML = `
        <div class="row">
            <div class="col-md-4">
                <p class="mb-1"><strong>Amount:</strong> ${paymentInfo.currency} ${paymentInfo.amount}</p>
            </div>
            <div class="col-md-4">
                <p class="mb-1"><strong>Status:</strong> <span class="badge bg-success">${paymentInfo.paymentStatus}</span></p>
            </div>
            <div class="col-md-4">
                <p class="mb-1"><strong>Payment Date:</strong> ${new Date(paymentInfo.paymentDate).toLocaleDateString()}</p>
            </div>
        </div>
    `;
}

// Display action buttons
function displayActionButtons(status) {
    const container = document.getElementById('actionButtons');
    
    if (status === 'CANCELLED') {
        container.innerHTML = '<p class="text-muted"><i class="fas fa-info-circle"></i> This booking has been cancelled. No actions available.</p>';
        return;
    }
    
    if (status === 'CHANGED') {
        container.innerHTML = `
            <button class="btn btn-baggage btn-action" onclick="showBaggageModal()">
                <i class="fas fa-suitcase"></i> Purchase Baggage
            </button>
            <p class="text-muted mt-2"><i class="fas fa-info-circle"></i> This booking has been changed. Refund and change options are not available.</p>
        `;
        return;
    }
    
    container.innerHTML = `
        <button class="btn btn-refund btn-action" onclick="showRefundModal()">
            <i class="fas fa-undo"></i> Request Refund
        </button>
        <button class="btn btn-change btn-action" onclick="showChangeModal()">
            <i class="fas fa-exchange-alt"></i> Change Flight
        </button>
        <button class="btn btn-baggage btn-action" onclick="showBaggageModal()">
            <i class="fas fa-suitcase"></i> Purchase Baggage
        </button>
    `;
}

// Populate passenger dropdown for baggage modal
function populatePassengerDropdown(passengers) {
    const select = document.getElementById('baggagePassenger');
    select.innerHTML = '<option value="">Choose passenger...</option>' +
        passengers.map(p => `
            <option value="${p.passengerId}">${p.firstName} ${p.lastName}</option>
        `).join('');
}

// Show refund modal
function showRefundModal() {
    const modal = new bootstrap.Modal(document.getElementById('refundModal'));
    modal.show();
}

// Show change modal
function showChangeModal() {
    const modal = new bootstrap.Modal(document.getElementById('changeModal'));
    modal.show();
}

// Show baggage modal
function showBaggageModal() {
    const modal = new bootstrap.Modal(document.getElementById('baggageModal'));
    modal.show();
    
    // Reset selections
    selectedBaggageType = null;
    selectedBaggagePrice = 0;
    document.querySelectorAll('.baggage-option').forEach(opt => opt.classList.remove('selected'));
    document.getElementById('equipmentTypeContainer').style.display = 'none';
    document.getElementById('baggageQuantity').value = 1;
    updateBaggageTotal();
}

// Baggage option selection
document.querySelectorAll('.baggage-option').forEach(option => {
    option.addEventListener('click', function() {
        // Remove selected class from all options
        document.querySelectorAll('.baggage-option').forEach(opt => opt.classList.remove('selected'));
        
        // Add selected class to clicked option
        this.classList.add('selected');
        
        selectedBaggageType = this.dataset.type;
        selectedBaggagePrice = parseFloat(this.dataset.price);
        
        // Show equipment type selector for sports equipment
        if (selectedBaggageType === 'SPORTS_EQUIPMENT') {
            document.getElementById('equipmentTypeContainer').style.display = 'block';
        } else {
            document.getElementById('equipmentTypeContainer').style.display = 'none';
        }
        
        updateBaggageTotal();
    });
});

// Update baggage total when quantity changes
document.getElementById('baggageQuantity').addEventListener('input', updateBaggageTotal);

// Update baggage total
function updateBaggageTotal() {
    const quantity = parseInt(document.getElementById('baggageQuantity').value) || 1;
    const total = selectedBaggagePrice * quantity;
    document.getElementById('baggageTotal').textContent = `$${total.toFixed(2)}`;
}

// Submit refund request
async function submitRefund() {
    const reason = document.getElementById('refundReason').value;
    const details = document.getElementById('refundDetails').value;
    
    if (!reason) {
        showAlert('warning', 'Please select a refund reason');
        return;
    }
    
    const lastName = document.getElementById('passengerLastName').value;
    
    try {
        const response = await fetch('/api/flights/refund/process', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                bookingId: currentOrder.bookingId,
                confirmationNumber: currentOrder.confirmationNumber,
                refundReason: reason,
                reasonDetails: details,
                passengerLastName: lastName
            })
        });
        
        const result = await response.json();
        
        // Close refund modal
        bootstrap.Modal.getInstance(document.getElementById('refundModal')).hide();
        
        // Show result
        if (result.status === 'SUCCESS') {
            showResultModal('success', 'Refund Request Successful', `
                <div class="alert alert-success">
                    <h6><i class="fas fa-check-circle"></i> Refund Processed Successfully</h6>
                    <p class="mb-2">${result.message}</p>
                </div>
                <div class="mb-3">
                    <p><strong>Refund ID:</strong> ${result.refundId}</p>
                    <p><strong>Original Amount:</strong> ${result.currency} ${result.refundAmount}</p>
                    <p><strong>Cancellation Fee:</strong> ${result.currency} ${result.cancellationFee}</p>
                    <p><strong>Net Refund:</strong> ${result.currency} ${result.netRefundAmount}</p>
                    <p><strong>Estimated Processing Time:</strong> ${result.estimatedRefundDays} days</p>
                </div>
                <p class="text-muted small">Your refund will be processed to the original payment method.</p>
            `);
            
            // Refresh order to show updated status
            setTimeout(() => {
                location.reload();
            }, 3000);
        } else {
            showResultModal('danger', 'Refund Request Failed', `
                <div class="alert alert-danger">
                    <h6><i class="fas fa-exclamation-triangle"></i> Refund Failed</h6>
                    <p class="mb-0">${result.message}</p>
                </div>
                <div class="mt-3">
                    <p><strong>Reason:</strong> ${result.failureReason}</p>
                    <p class="text-muted">If you believe this is an error, please contact customer service.</p>
                </div>
            `);
        }
    } catch (error) {
        console.error('Error processing refund:', error);
        showResultModal('danger', 'Error', `
            <div class="alert alert-danger">
                <p class="mb-0">Failed to process refund request. Please try again later.</p>
            </div>
        `);
    }
}

// Submit baggage purchase
async function submitBaggage() {
    const passengerId = document.getElementById('baggagePassenger').value;
    const quantity = parseInt(document.getElementById('baggageQuantity').value);
    const requirements = document.getElementById('baggageRequirements').value;
    
    if (!passengerId) {
        showAlert('warning', 'Please select a passenger');
        return;
    }
    
    if (!selectedBaggageType) {
        showAlert('warning', 'Please select a baggage type');
        return;
    }
    
    if (quantity < 1 || quantity > 5) {
        showAlert('warning', 'Please enter a valid quantity (1-5)');
        return;
    }
    
    const lastName = document.getElementById('passengerLastName').value;
    
    const requestData = {
        bookingId: currentOrder.bookingId,
        confirmationNumber: currentOrder.confirmationNumber,
        passengerLastName: lastName,
        passengerId: passengerId,
        additionalBags: quantity,
        baggageType: selectedBaggageType,
        specialRequirements: requirements
    };
    
    if (selectedBaggageType === 'SPORTS_EQUIPMENT') {
        requestData.equipmentType = document.getElementById('equipmentType').value;
    }
    
    try {
        const response = await fetch('/api/flights/baggage/purchase', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestData)
        });
        
        const result = await response.json();
        
        // Close baggage modal
        bootstrap.Modal.getInstance(document.getElementById('baggageModal')).hide();
        
        // Show result
        if (result.status === 'SUCCESS') {
            const itemsList = result.baggageItems.map(item => `
                <li>${item.description} - ${item.quantity} x ${result.currency} ${item.unitPrice} = ${result.currency} ${item.totalPrice}</li>
            `).join('');
            
            showResultModal('success', 'Baggage Purchase Successful', `
                <div class="alert alert-success">
                    <h6><i class="fas fa-check-circle"></i> Baggage Purchased Successfully</h6>
                    <p class="mb-0">${result.message}</p>
                </div>
                <div class="mb-3">
                    <p><strong>Order ID:</strong> ${result.baggageOrderId}</p>
                    <p><strong>Items Purchased:</strong></p>
                    <ul>${itemsList}</ul>
                    <p><strong>Total Amount:</strong> ${result.currency} ${result.totalAmount}</p>
                    <p><strong>Payment Status:</strong> <span class="badge bg-success">${result.paymentStatus}</span></p>
                </div>
            `);
        } else {
            showResultModal('danger', 'Baggage Purchase Failed', `
                <div class="alert alert-danger">
                    <h6><i class="fas fa-exclamation-triangle"></i> Purchase Failed</h6>
                    <p class="mb-0">${result.message}</p>
                </div>
                <div class="mt-3">
                    <p><strong>Reason:</strong> ${result.failureReason}</p>
                    <p class="text-muted">Please try again or contact customer service for assistance.</p>
                </div>
            `);
        }
    } catch (error) {
        console.error('Error purchasing baggage:', error);
        showResultModal('danger', 'Error', `
            <div class="alert alert-danger">
                <p class="mb-0">Failed to process baggage purchase. Please try again later.</p>
            </div>
        `);
    }
}

// Show result modal
function showResultModal(type, title, content) {
    const modal = new bootstrap.Modal(document.getElementById('resultModal'));
    const header = document.getElementById('resultModalHeader');
    const titleEl = document.getElementById('resultModalTitle');
    const body = document.getElementById('resultModalBody');
    
    // Set header color
    if (type === 'success') {
        header.style.background = 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)';
    } else if (type === 'danger') {
        header.style.background = 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)';
    } else {
        header.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
    }
    
    titleEl.textContent = title;
    body.innerHTML = content;
    
    modal.show();
}

// Show alert
function showAlert(type, message) {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    document.querySelector('.container').insertBefore(alertDiv, document.querySelector('.search-container'));
    
    // Auto dismiss after 5 seconds
    setTimeout(() => {
        alertDiv.remove();
    }, 5000);
}
