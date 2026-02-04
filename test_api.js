const fetch = require('node-fetch');

async function test() {
    try {
        const response = await fetch('http://localhost:3000/api/propiedadia/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                propertyType: 'departamento',
                location: 'Santiago',
                rooms: '2',
                bathrooms: '1',
                size: '60'
            })
        });
        const status = response.status;
        const data = await response.json();
        console.log(JSON.stringify({ status, data }, null, 2));
    } catch (error) {
        console.error('Test error:', error.message);
    }
}

test();
