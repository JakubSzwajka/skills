export async function startWithConfiguredApiKey<T>(
	apiKey: string,
	start: () => Promise<T>,
): Promise<T> {
	const previous = process.env.BLOCKS_API_KEY;
	process.env.BLOCKS_API_KEY = apiKey;
	try {
		return await start();
	} finally {
		if (previous === undefined) delete process.env.BLOCKS_API_KEY;
		else process.env.BLOCKS_API_KEY = previous;
	}
}
