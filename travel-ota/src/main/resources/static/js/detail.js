let selectedFlight = null;
let selectedFare = null;

// Initialize after page loads
document.addEventListener('DOMContentLoaded', function() {
    // Get selected flight information from sessionStorage
    const flightData = sessionStorage.getItem('selectedFlight');
    
    if (!flightData) {
        alert('No selected flight information, please select again');
        window.location.href = '/list.html';
        return;
    }
    
    const data = JSON.parse(flightData);
    selectedFlight = data.flight;
    selectedFare = data.fare;
    
    // Render page
    renderFlightDetail();
    renderFlightOptions();
});

// Render flight details
function renderFlightDetail() {
    const flightDetail = document.getElementById('flightDetail');
    
    flightDetail.innerHTML = `
        <div class="d-flex justify-content-between align-items-center mb-3">
            <div>
                <div class="fw-bold">Outbound ${formatDate(selectedFlight.departureTime)}</div>
                <div class="text-muted">All times are local time</div>
            </div>
            <div class="text-end">
                <i class="fas fa-chevron-up"></i>
            </div>
        </div>
        
        <div class="flight-route">
            <div class="flight-time">
                <div class="h5">${formatTime(selectedFlight.departureTime)}</div>
                <div class="text-muted">${selectedFlight.departureAirport}</div>
                <div class="text-muted">${selectedFlight.departureCity}</div>
            </div>
            
            <div class="flight-duration">
                <div class="fw-bold">${Math.floor(selectedFlight.durationMinutes / 60)}h ${selectedFlight.durationMinutes % 60}m</div>
                <div class="flight-arrow">
                    <i class="fas fa-arrow-right"></i>
                </div>
                <div class="text-muted">${selectedFlight.flightType}</div>
            </div>
            
            <div class="flight-time">
                <div class="h5">${formatTime(selectedFlight.arrivalTime)}</div>
                <div class="text-muted">${selectedFlight.arrivalAirport}</div>
                <div class="text-muted">${selectedFlight.arrivalCity}</div>
            </div>
        </div>
        
        <div class="border-top pt-3">
            <div class="fw-bold">${selectedFlight.airlineName} ${selectedFlight.flightNumber}</div>
            <div class="d-flex align-items-center mt-2">
                ${selectedFlight.hasWifi ? '<div class="amenity-icon"><i class="fas fa-wifi"></i></div>' : ''}
                ${selectedFlight.hasPowerOutlet ? '<div class="amenity-icon"><i class="fas fa-plug"></i></div>' : ''}
                <span class="text-muted">Show information</span>
            </div>
        </div>
        
        <div class="border-top pt-3 mt-3">
            <div class="text-muted">
                Arrival: ${formatDate(selectedFlight.arrivalTime)} | Duration: ${Math.floor(selectedFlight.durationMinutes / 60)}h ${selectedFlight.durationMinutes % 60}m
            </div>
        </div>
    `;
}

// Render flight options
function renderFlightOptions() {
    const flightOptions = document.getElementById('flightOptions');
    
    flightOptions.innerHTML = selectedFlight.fareOptions.map(fare => `
        <div class="fare-option ${fare.isRecommended ? 'recommended' : ''}">
            <div class="row align-items-center">
                <div class="col-md-8">
                    <div class="d-flex align-items-center mb-2">
                        <div class="me-3">
                            <div class="d-flex align-items-center">
                                <div class="fw-bold me-2">${fare.fareBrand || 'Standard'}</div>
                                ${fare.isRecommended ? '<span class="badge bg-success">Recommended</span>' : ''}
                            </div>
                            <div class="text-muted small">${fare.description || 'Standard fare'}</div>
                            <div class="rating mt-1">
                                ${'★'.repeat(fare.rating)} <span class="text-muted">(${fare.reviewCount})</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="row mt-3">
                        <div class="col-md-6">
                            <div class="baggage-info">
                                <div class="baggage-item">
                                    <i class="fas fa-suitcase"></i>
                                    ${fare.baggageInfo.cabinBags} Carry-on Baggage
                                </div>
                                <div class="baggage-item">
                                    <i class="fas fa-suitcase-rolling"></i>
                                    ${fare.baggageInfo.checkedBags >= 0 ? fare.baggageInfo.checkedBags : '?'} Checked Baggage
                                </div>
                            </div>
                        </div>
                        <div class="col-md-6">
                            <div class="fare-features">
                                <div class="feature-item">
                                    <i class="fas fa-exchange-alt"></i>
                                    ${getRefundText(fare.fareBrand)}
                                </div>
                                <div class="feature-item">
                                    <i class="fas fa-edit"></i>
                                    ${getChangeText(fare.fareBrand)}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="col-md-4 text-end">
                    <div class="h3 mb-2">${fare.currency}${fare.price}</div>
                    <div class="text-muted small mb-2">Per person</div>
                    <button class="btn btn-book" onclick="bookFlight('${fare.fareId}')">
                        Book
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}

// Get refund policy text
function getRefundText(fareBrand) {
    const refundPolicies = {
        'Basic': 'Non-refundable',
        'Standard': 'Partial refund',
        'Flex': 'Free refund',
        'Premium': 'Free refund'
    };
    return refundPolicies[fareBrand] || 'Partial refund';
}

// Get change policy text
function getChangeText(fareBrand) {
    const changePolicies = {
        'Basic': 'Non-changeable',
        'Standard': 'Paid change',
        'Flex': 'Free change',
        'Premium': 'Free change'
        };
    return changePolicies[fareBrand] || 'Paid change';
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
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `${days[date.getDay()]}, ${date.getDate()} ${date.toLocaleDateString('en-US', { month: 'short' })} ${date.getFullYear()}`;
}

// Book flight
function bookFlight(fareId) {
    // Store selected fare information to sessionStorage
    const selectedFare = selectedFlight.fareOptions.find(f => f.fareId === fareId);
    
    sessionStorage.setItem('bookingInfo', JSON.stringify({
        flight: selectedFlight,
        fare: selectedFare
    }));
    
    // Navigate to booking page
    window.location.href = '/booking.html';
} 