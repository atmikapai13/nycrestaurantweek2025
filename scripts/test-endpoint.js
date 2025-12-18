
const colors = {
    reset: "\x1b[0m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
};

async function testScenario(name, payload, validators) {
    console.log(colors.cyan + `\n🧪 TEST SCENARIO: ${name}` + colors.reset);
    console.log(colors.yellow + `   Query: "${payload.message}"` + colors.reset);

    try {
        const response = await fetch('http://localhost:3000/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const data = await response.json();
        console.log(`   Agent: "${data.response.substring(0, 60)}..."`);

        let passed = true;
        for (const check of validators) {
            const result = check(data);
            if (result.success) {
                console.log(colors.green + `   ✅ ${result.message}` + colors.reset);
            } else {
                console.log(colors.red + `   ❌ ${result.message}` + colors.reset);
                passed = false;
            }
        }
        return passed;
    } catch (error) {
        console.log(colors.red + `   ❌ CRITICAL ERROR: ${error.message}` + colors.reset);
        return false;
    }
}

async function runSuite() {
    console.log(colors.magenta + "🚀 Starting Frontend-Backend Integration Tests..." + colors.reset);
    console.log(colors.blue + "   Target: http://localhost:3000/api/chat" + colors.reset);

    // TEST 1: Pink Markers (Filter/Search)
    // "Show me Italian restaurants in Chelsea" -> Should return visible_restaurants
    await testScenario(
        "Pink Markers / Map Resize",
        { message: "Show me Italian restaurants in Chelsea", conversationHistory: [] },
        [
            (data) => ({
                success: data.visible_restaurants && data.visible_restaurants.length > 0,
                message: `Returned ${data.visible_restaurants?.length || 0} visible restaurants (Triggers Pink Markers)`
            }),
            (data) => ({
                success: data.tool_calls.includes('filter_restaurants') || data.tool_calls.includes('semantic_search_restaurants'),
                message: `Agent used correct tool: ${data.tool_calls.join(', ')}`
            })
        ]
    );

    // TEST 2: Isochrones (Polygon Lines)
    // "Show me restaurants within 15 min walk from Union Square" -> Should return isochrone_data
    await testScenario(
        "Isochrone Generation",
        { message: "Show me restaurants within 15 min walk from Union Square", conversationHistory: [] },
        [
            (data) => ({
                success: data.isochrone_data && data.isochrone_data.polygon,
                message: "Returned isochrone_data.polygon (Triggers Map Layer Draw)"
            }),
            (data) => ({
                success: data.isochrone_data && data.isochrone_data.center,
                message: "Returned isochrone_data.center (Triggers Camera Fly)"
            }),
            (data) => ({
                success: data.tool_calls.includes('create_isochrone'),
                message: "Agent used create_isochrone tool"
            })
        ]
    );

    console.log(colors.magenta + "\n✨ Suite Complete." + colors.reset);
}

runSuite();
