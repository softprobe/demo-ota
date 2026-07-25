// Passenger information
let passengerData = {
    adults: 1,
    children: 0,
    infants: 0
};

let selectedTripType = 'ONE_WAY';
let selectedCabinClass = 'ECONOMY';

// Initialize after page loads
document.addEventListener('DOMContentLoaded', function() {
    // Set default date to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    document.getElementById('departureDate').value = tomorrow.toISOString().split('T')[0];
    
    // Bind form submit event
    document.getElementById('searchForm').addEventListener('submit', handleSearch);
    
    // Bind trip type selection event
    document.querySelectorAll('.trip-type-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.trip-type-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            selectedTripType = this.dataset.type;
        });
    });
});

// Toggle passenger selection modal
function togglePassengerModal() {
    const modal = new bootstrap.Modal(document.getElementById('passengerModal'));
    modal.show();
}

// Change passenger count
function changeCount(type, change) {
    const newCount = passengerData[type] + change;
    
    // Validate quantity limits
    if (type === 'adults' && newCount < 1) return;
    if (type === 'children' && newCount < 0) return;
    if (type === 'infants' && newCount < 0) return;
    if (type === 'infants' && newCount > passengerData.adults) return;
    
    passengerData[type] = newCount;
    document.getElementById(type + 'Count').textContent = newCount;
    
    // Update button states
    updateCounterButtons();
}

// Update counter button states
function updateCounterButtons() {
    // Adults minimum 1
    const adultBtns = document.querySelectorAll('[onclick*="adults"]');
    adultBtns[0].disabled = passengerData.adults <= 1;
    
    // Children and infants cannot be negative
    const childBtns = document.querySelectorAll('[onclick*="children"]');
    childBtns[0].disabled = passengerData.children <= 0;
    
    const infantBtns = document.querySelectorAll('[onclick*="infants"]');
    infantBtns[0].disabled = passengerData.infants <= 0;
    infantBtns[1].disabled = passengerData.infants >= passengerData.adults;
}

// Confirm passenger selection
function confirmPassengerSelection() {
    selectedCabinClass = document.getElementById('cabinClass').value;
    
    // Update display text
    let summary = '';
    if (passengerData.adults > 0) {
        summary += passengerData.adults + ' Adult';
    }
    if (passengerData.children > 0) {
        summary += (summary ? ', ' : '') + passengerData.children + ' Child';
    }
    if (passengerData.infants > 0) {
        summary += (summary ? ', ' : '') + passengerData.infants + ' Infant';
    }
    
    const cabinClassText = {
        'ECONOMY': 'Economy',
        'PREMIUM_ECONOMY': 'Premium Economy',
        'BUSINESS': 'Business',
        'FIRST': 'First Class'
    };
    
    summary += ', ' + cabinClassText[selectedCabinClass];
    document.getElementById('passengerSummary').textContent = summary;
    
    // Close modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('passengerModal'));
    modal.hide();
}

// Handle search request
async function handleSearch(event) {
    event.preventDefault();
    
    const searchData = {
        fromCity: document.getElementById('fromCity').value,
        toCity: document.getElementById('toCity').value,
        departureDate: document.getElementById('departureDate').value,
        tripType: selectedTripType,
        cabinClass: selectedCabinClass,
        passengerInfo: {
            adults: passengerData.adults,
            children: passengerData.children,
            infants: passengerData.infants
        }
    };
    
    try {
        const response = await fetch('/api/flights/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-sp-session-id': getSessionId()
            },
            body: JSON.stringify(searchData)
        });
        
        if (response.ok) {
            const result = await response.json();
            // Store search results to sessionStorage, then navigate to list page
            sessionStorage.setItem('searchResults', JSON.stringify(result));
            sessionStorage.setItem('searchRequest', JSON.stringify(searchData));
            window.location.href = '/list.html';
        } else {
            alert('Search failed, please try again');
        }
    } catch (error) {
        console.error('Search error:', error);
        alert('Search failed, please check network connection');
    }
}