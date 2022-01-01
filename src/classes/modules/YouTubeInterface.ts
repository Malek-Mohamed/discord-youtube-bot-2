import {
	AudioPlayer,
	AudioPlayerIdleState,
	AudioPlayerPlayingState,
	AudioPlayerState,
	AudioPlayerStatus,
	AudioResource,
	createAudioPlayer,
	VoiceConnection
} from '@discordjs/voice';
import { QueueManager } from 'bot-classes';
import { config, globals } from 'bot-config';
import { Guild } from 'discord.js';
import { BaseAudioInterface } from '../BaseAudioInterface';
import YouTubeVideo from './YouTubeVideo';

export default class YouTubeInterface implements BaseAudioInterface {
	private audioPlayer: AudioPlayer;
	private audioVolume: number;
	private voiceConnection?: VoiceConnection;
	private currentResource?: AudioResource | null;
	queue: QueueManager;

	/**
	 * An easy toolbox for managing YouTube audio for this bot.
	 */
	constructor(guild: Guild) {
		this.audioPlayer = createAudioPlayer();
		this.audioVolume = config.audioVolume;
		this.queue = QueueManager.fromGuild(guild, 'youtube');
	}

	/**
	 * Get the YouTube-based queue instance for a given guild. Will try to get one that already exists, but will create a new one if not.
	 * @param guild The guild to get the instance for.
	 */
	static fromGuild(guild: Guild) {
		if (!globals.youtubePlayers.has(guild.id)) {
			globals.youtubePlayers.set(guild.id, new YouTubeInterface(guild));
		}

		return globals.youtubePlayers.get(guild.id) as YouTubeInterface;
	}

	/**
	 * Set a connection instance to the guild.
	 * @param connection Connection to set.
	 */
	setConnection(connection: VoiceConnection) {
		this.voiceConnection = connection;
		this.voiceConnection.subscribe(this.player);
	}

	/**
	 * Open the database connection.
	 */
	async open() {
		await this.queue.open();
	}

	/**
	 * Close the database connection.
	 */
	async close() {
		this.queue.close();
	}

	/**
	 * Get the connection instance associated with this guild.
	 */
	get connection() {
		return this.voiceConnection || null;
	}

	/**
	 * Get the video info. By default it is the first item in the queue.
	 * @param queueItemIndex The queue item index.
	 */
	async getItemInfo(queueItemIndex: number = 0) {
		const videoId = await this.queue.get(queueItemIndex);
		if (!videoId) return null;
		const youtubeVideo = YouTubeVideo.fromId(videoId);

		return await youtubeVideo.info();
	}

	/**
	 * Get the player instance associated with this guild.
	 */
	get player() {
		return this.audioPlayer;
	}

	/**
	 * Is the bot playing audio in thie guild?
	 */
	get busy() {
		const connection = this.connection;
		if (!connection?.state.status) return false;
		if (connection?.state.status !== 'destroyed') return true;
		return false;
	}

	/**
	 * Start the execution of the queue by joining the bot and playing audio.
	 * To use this, await this method in a while loop. Will resolve true to indicate finish, and null to stop.
	 */
	runner(): Promise<true | null> {
		return new Promise(async resolve => {
			try {
				const player = this.player;
				const videoId = await this.queue.first(); // Video ID
				const queueLength = await this.queue.length();

				if (!videoId || !queueLength) {
					resolve(null);
					return;
				}

				const youtubeVideo = YouTubeVideo.fromId(videoId);
				const audioResource = await youtubeVideo.download();

				const onIdleCallback = async (oldState: AudioPlayerState, newState: AudioPlayerState) => {
					if (oldState.status === 'playing' && newState.status === 'idle') {
						player.removeListener('stateChange', onIdleCallback);
						await this.queue.deleteFirst();
						resolve(true);
					}
				};

				player.on('stateChange', onIdleCallback);

				if (!audioResource) {
					console.error('Audio playback skipped due to no audio resource being detected.');
					player.removeListener('stateChange', onIdleCallback);
					await this.queue.deleteFirst();
					resolve(true);
					return;
				}

				this.currentResource = audioResource;
				this.currentResource.volume?.setVolume(this.audioVolume);
				player.play(this.currentResource);

				// Ytdl core sometimes does not reliably download the audio data, so this handles the error.
				player.once('error', async () => {
					console.error('Audio playback skipped due to invalid stream data!');
					await this.queue.deleteFirst();
					player.removeListener('stateChange', onIdleCallback);
					resolve(true);
				});
			} catch (error) {
				console.error(error);
				await this.queue.deleteFirst();
				resolve(true);
			}
		});
	}

	/**
	 * Destroy the connection instance associated with this guild
	 */
	deleteConnection() {
		this.currentResource = null;
		const destroyed = this.connection?.state.status === 'destroyed';

		if (this.connection instanceof VoiceConnection && !destroyed) {
			this.connection.disconnect();
			this.connection.destroy();
			return true;
		}

		return null;
	}

	/**
	 * Get the current audio resource
	 */
	get currentAudioResource() {
		return this.currentResource || null;
	}

	/**
	 * Set the audible volume of the bot.
	 * @param volume Volume between 0 and 100
	 */
	setVolume(volume: number): boolean {
		try {
			if (volume < 0 || volume > 100) {
				return false;
			}

			this.audioVolume = volume / 100; // 0 is mute, 1 is max volume.
			const currentAudioResource = this.currentAudioResource;

			if (currentAudioResource) {
				currentAudioResource.volume?.setVolume(this.audioVolume);
			}

			return true;
		} catch (error) {
			return false;
		}
	}

	/**
	 * The current volume level for this instance.
	 */
	get volume() {
		return this.audioVolume * 100;
	}

	/**
	 * Emit the exact event that will happen when the bot gets to the end of its current audio track. Useful for skipping.
	 */
	emitAudioFinish() {
		const currentAudioResource = this.currentAudioResource;
		const player = this.player;
		if (!(currentAudioResource instanceof AudioResource)) return null;

		const oldState: AudioPlayerPlayingState = {
			status: AudioPlayerStatus.Playing,
			playbackDuration: currentAudioResource.playbackDuration,
			missedFrames: 0,
			resource: currentAudioResource,
			onStreamError: console.error
		};

		const newState: AudioPlayerIdleState = {
			status: AudioPlayerStatus.Idle
		};

		player.emit('stateChange', oldState, newState);
		return true;
	}
}
