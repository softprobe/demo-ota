let bookingInfo = null;
let searchRequest = null;

// Initialize after page loads
document.addEventListener('DOMContentLoaded', function() {
    // Get booking information from sessionStorage
    const bookingData = sessionStorage.getItem('bookingInfo');
    const requestData = sessionStorage.getItem('searchRequest');
    
    if (!bookingData || !requestData) {
        alert('No booking information, please select flight again');
        window.location.href = '/list.html';
        return;
    }
    
    bookingInfo = JSON.parse(bookingData);
    searchRequest = JSON.parse(requestData);
    
    // Render page
    renderFlightSummary();
    renderPriceSummary();
    renderPassengerForms();
    
    // Bind form submit event
    document.getElementById('bookingForm').addEventListener('submit', handleBooking);
});

// Render flight summary
function renderFlightSummary() {
    const flightSummary = document.getElementById('flightSummary');
    const flight = bookingInfo.flight;
    
    flightSummary.innerHTML = `
        <div class="d-flex justify-content-between align-items-center mb-3">
            <div>
                <div class="fw-bold">${flight.airlineName} ${flight.flightNumber}</div>
                <div class="text-muted">${flight.cabinClass || 'Economy'}</div>
            </div>
            <div class="text-end">
                <div class="h5 mb-0">${bookingInfo.fare.currency}${bookingInfo.fare.price}</div>
                <div class="text-muted">Per person</div>
            </div>
        </div>
        
        <div class="flight-route">
            <div class="flight-time">
                <div class="h5">${formatTime(flight.departureTime)}</div>
                <div class="text-muted">${flight.departureAirport}</div>
                <div class="text-muted">${flight.departureCity}</div>
            </div>
            
            <div class="flight-duration">
                <div class="fw-bold">${Math.floor(flight.durationMinutes / 60)}h ${flight.durationMinutes % 60}m</div>
                <div class="flight-arrow">
                    <i class="fas fa-arrow-right"></i>
                </div>
                <div class="text-muted">${flight.flightType}</div>
            </div>
            
            <div class="flight-time">
                <div class="h5">${formatTime(flight.arrivalTime)}</div>
                <div class="text-muted">${flight.arrivalAirport}</div>
                <div class="text-muted">${flight.arrivalCity}</div>
            </div>
        </div>
        
        <div class="border-top pt-3">
            <div class="text-muted">
                Departure Date: ${formatDate(flight.departureTime)}
            </div>
        </div>
    `;
}

// Render price summary
function renderPriceSummary() {
    const priceSummary = document.getElementById('priceSummary');
    const fare = bookingInfo.fare;
    const passengerInfo = searchRequest.passengerInfo;
    const totalPassengers = passengerInfo.adults + passengerInfo.children + passengerInfo.infants;
    const totalAmount = fare.price * totalPassengers;
    
    priceSummary.innerHTML = `
        <div class="row mb-3">
            <div class="col-6">Flight Fee</div>
            <div class="col-6 text-end">${fare.currency}${fare.price} × ${totalPassengers}</div>
        </div>
        <div class="row mb-3">
            <div class="col-6">Taxes</div>
            <div class="col-6 text-end">${fare.currency}0</div>
        </div>
        <div class="row mb-3">
            <div class="col-6">Service Fee</div>
            <div class="col-6 text-end">${fare.currency}0</div>
        </div>
        <hr>
        <div class="row">
            <div class="col-6 h5 mb-0">Total</div>
            <div class="col-6 text-end h5 mb-0">${fare.currency}${totalAmount}</div>
        </div>
    `;
}

// Render passenger forms
function renderPassengerForms() {
    const passengerForms = document.getElementById('passengerForms');
    const passengerInfo = searchRequest.passengerInfo;
    
    let formHTML = '';
    let passengerIndex = 0;
    
    // Adult passengers
    for (let i = 0; i < passengerInfo.adults; i++) {
        formHTML += createPassengerForm('ADULT', passengerIndex + 1, 'Adult');
        passengerIndex++;
    }
    
    // Child passengers
    for (let i = 0; i < passengerInfo.children; i++) {
        formHTML += createPassengerForm('CHILD', passengerIndex + 1, 'Child');
        passengerIndex++;
    }
    
    // Infant passengers
    for (let i = 0; i < passengerInfo.infants; i++) {
        formHTML += createPassengerForm('INFANT', passengerIndex + 1, 'Infant');
        passengerIndex++;
    }
    
    passengerForms.innerHTML = formHTML;
}

// Create passenger form
function createPassengerForm(passengerType, index, label) {
    return `
        <div class="passenger-form">
            <div class="passenger-header">
                <h6 class="mb-0"><i class="fas fa-user"></i> ${label} ${index}</h6>
            </div>
            
            <div class="row">
                <div class="col-md-6 mb-3">
                    <label class="form-label">Last Name *</label>
                    <input type="text" class="form-control" name="passenger_${index}_lastName" required>
                </div>
                <div class="col-md-6 mb-3">
                    <label class="form-label">First Name *</label>
                    <input type="text" class="form-control" name="passenger_${index}_firstName" required>
                </div>
            </div>
            
            <div class="row">
                <div class="col-md-6 mb-3">
                    <label class="form-label">Document Type *</label>
                    <select class="form-select" name="passenger_${index}_documentType" required>
                        <option value="">Please select</option>
                        <option value="PASSPORT">Passport</option>
                        <option value="ID_CARD">ID Card</option>
                    </select>
                </div>
                <div class="col-md-6 mb-3">
                    <label class="form-label">Document Number *</label>
                    <input type="text" class="form-control" name="passenger_${index}_documentNumber" required>
                </div>
            </div>
            
            ${passengerType !== 'ADULT' ? `
                <div class="mb-3">
                    <label class="form-label">Date of Birth *</label>
                    <input type="date" class="form-control" name="passenger_${index}_dateOfBirth" required>
                </div>
            ` : ''}
        </div>
    `;
}

// Format time
function formatTime(dateTimeString) {
    const date = new Date(dateTimeString);
    return date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
    });
}

// Format date
function formatDate(dateTimeString) {
    const date = new Date(dateTimeString);
    return date.toLocaleDateString('en-US');
}

// Handle booking submission
async function handleBooking(event) {
    event.preventDefault();
    
    // Collect form data
    const formData = new FormData(event.target);
    const passengers = [];
    const passengerInfo = searchRequest.passengerInfo;
    const totalPassengers = passengerInfo.adults + passengerInfo.children + passengerInfo.infants;
    
    for (let i = 1; i <= totalPassengers; i++) {
        const passenger = {
            passengerType: i <= passengerInfo.adults ? 'ADULT' : 
                          i <= passengerInfo.adults + passengerInfo.children ? 'CHILD' : 'INFANT',
            lastName: formData.get(`passenger_${i}_lastName`),
            firstName: formData.get(`passenger_${i}_firstName`),
            documentType: formData.get(`passenger_${i}_documentType`),
            documentNumber: formData.get(`passenger_${i}_documentNumber`)
        };
        
        if (passenger.passengerType !== 'ADULT') {
            passenger.dateOfBirth = formData.get(`passenger_${i}_dateOfBirth`);
        }
        
        passengers.push(passenger);
    }
    
    const bookingData = {
        fareId: bookingInfo.fare.fareId,
        flightId: bookingInfo.flight.flightId,
        passengers: passengers,
        contactInfo: {
            phone: document.getElementById('contactPhone').value,
            email: document.getElementById('contactEmail').value,
            address: document.getElementById('contactAddress').value
        }
    };
    
    try {
        const response = await fetch('/api/flights/book', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-sp-session-id': getSessionId()
            },
            body: JSON.stringify(bookingData)
        });
        
        if (response.ok) {
            const result = await response.json();
            // Store booking result to sessionStorage, then navigate to payment page
            console.log('Booking result:', result);
            sessionStorage.setItem('bookingResult', JSON.stringify(result));
            window.location.href = '/payment.html';
        } else {
            alert('Booking failed, please try again');
        }
    } catch (error) {
        console.error('Booking error:', error);
        alert('Booking failed, please check network connection');
    }
}