import { youtube_v3 } from '@googleapis/youtube';
import { YouTubeVideo } from 'bot-classes';
import { config, globals } from 'bot-config';
import { YouTubeBase } from './YouTubeBase';

export class YouTubePlaylist extends YouTubeBase {
	constructor(url: string) {
		super(url);
	}

	/**
	 * Get a new instance of this class using the resource ID.
	 * @param id The resource ID
	 */
	static fromId(id: string) {
		return new this(`https://www.youtube.com/playlist?list=${id}`);
	}

	/**
	 * Get a new instance of this class using a video URL.
	 * @param url The video URL
	 */
	static fromUrl(url: string) {
		return new this(url);
	}

	/**
	 * Validate a given ID.
	 * @param id The video ID.
	 */
	private static validateId(id: string) {
		const regex = /^([a-zA-Z0-9-_]{34}|[a-zA-Z0-9-_]{13})$/;
		return regex.test(id);
	}

	/**
	 * Get the playlist ID.
	 */
	get id() {
		const id = this.urlInstance.searchParams.get('list');

		if (id && YouTubePlaylist.validateId(id)) {
			return id;
		}

		throw TypeError('ID for the video resource cannot be found.');
	}

	/**
	 * Fetch all the video resources using the playlist URL within this instance.
	 */
	async fetchVideos() {
		try {
			const params: youtube_v3.Params$Resource$Playlistitems$List = {
				part: ['snippet'],
				maxResults: config.playlistImportMaxSize,
				playlistId: this.id,
				pageToken: undefined
			};

			return new Promise<youtube_v3.Schema$PlaylistItem[]>(resolve => this.videoAccumulator(resolve, params));
		} catch (error) {
			console.error(error);
			return [];
		}
	}

	/**
	 * This function will run recursively to fetch ALL items from a playlist.
	 * Due to the paginated nature of the YouTube API, this essentially loops through each page accumulating items as it goes.
	 * For each iteration, it will:
	 *
	 * - Pass in modified params for the next API call
	 * - Pass in the previous accumulated values
	 * - And retain reference to the original promise resolver function.
	 *
	 * If the API response is good, it will append the new values to the previous accumulated values and re-invoke itself doing what was described on the line above.
	 * When the API has been exhausted, it will invoke the original resolver function resolving the promise.
	 */
	private async videoAccumulator(
		resolver: (value: youtube_v3.Schema$PlaylistItem[]) => void,
		nextParams: youtube_v3.Params$Resource$Playlistitems$List,
		accumulator: youtube_v3.Schema$PlaylistItem[] = []
	) {
		// The YouTube API does not paginate with numbers, it instead calculates a token that you must fetch by the response.
		const response = await globals.youtubeApi.playlistItems.list(nextParams);
		const items = response?.data?.items;

		if (!items) {
			resolver(accumulator);
			return;
		}

		nextParams.pageToken = response?.data?.nextPageToken || undefined;
		nextParams.maxResults = config.playlistImportMaxSize - accumulator.length;
		const accumulated = accumulator.concat(items); // Spread syntax ([...x, ...y]) is 3x slower than concat()

		if (nextParams.pageToken && nextParams.maxResults > 0) {
			this.videoAccumulator(resolver, nextParams, accumulated);
		} else {
			resolver(accumulated);
		}
	}

	/**
	 * Fetch all video URLs or IDs within this playlist.
	 */
	async fetchVideosStr(type: 'id' | 'url' = 'id') {
		const videos = await this.fetchVideos();

		if (!videos.length) return [];

		const urls: string[] = [];

		for (const video of videos) {
			const id = video.snippet?.resourceId?.videoId;

			if (id) {
				// YouTubeVideo class has validation.
				if (type === 'id') urls.push(YouTubeVideo.fromId(id).id);
				else if (type === 'url') urls.push(YouTubeVideo.fromId(id).url);
			}
		}

		return urls;
	}
}
