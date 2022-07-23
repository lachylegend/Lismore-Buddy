//when user logs in add their user id to the perms to this command and the edit profile command
const { SlashCommandBuilder } = require('@discordjs/builders');
const puppeteer = require('puppeteer');
const { MessageEmbed, MessageActionRow, MessageButton, ButtonInteraction } = require('discord.js');
// const { MessageEmbed, Util, MessageButton } = require('discord.js');
const UtilFunctions = require("../util/functions");


const data = new SlashCommandBuilder()
	.setName('message')
	.setDescription('Send or Read Messages to users on moodle, you need to be logged in for this function')
    // .setDefaultMemberPermissions(0) //admin can still use
    .addSubcommand(subcommand =>
		subcommand
			.setName('send')
			.setDescription('Send a message to a user')
            .addStringOption(option => 
                option
                    .setName('name-or-id') 
                    .setDescription('Name or Id of person you want to message (if same name > 1 then use last name)')
                    .setRequired(true)
            )
            .addStringOption(option => 
                option
                    .setName('message')
                    .setDescription('Send normal text or you could send html like <p style="color: green;">green text</p>')
                    .setRequired(true) // when I add the attachment option, don't make this required
            )
            .addIntegerOption(option =>
                option
                    .setName('times')
                    .setDescription('send heaps of messages to the person, min 1, max is 100!')
            )
    )
	.addSubcommand(subcommand =>
		subcommand
			.setName('read')
			.setDescription('Read the messages from a user')
            .addStringOption(option => 
                option
                    .setName('name-or-id')
                    .setDescription('Name or Id of person you want to message (if same name > 1 then use last name)')
                    .setRequired(true)
            )
            .addBooleanOption(option => 
                option
                    .setName('received')
                    .setDescription('Show recieved messages from person (default is true)')
                    .setRequired(false)
            )
            .addBooleanOption(option => 
                option
                    .setName('sent')
                    .setDescription('Show messages you sent to the person (default is false)')
                    .setRequired(false)
            )
            //TODO also make sure there aren't too many messages
    )


module.exports = {
    category: "login",
    permissions: [],
    devOnly: false,
    ...data.toJSON(),
    run: async (client, interaction) => {
        //TODO modularise all the main body of this script
        //normal, cause 3 seconds isn't fast enough
        await interaction.deferReply();
        //Make sure the user is logged in
        if(!UtilFunctions.loginGroups.hasOwnProperty(interaction.user.id)) {
            await interaction.editReply("You must login first to use this feature, You can log in here or in direct messages with this bot")
            //break out of this function early because they need to be logged in and they aren't
            return;
        }
        // const browser = await puppeteer.launch({ headless: false }) //slowMo:100
        const browser = await puppeteer.launch();
        const page = await browser.newPage();
        //log into the browser todo find a better way to do this
        await UtilFunctions.LoginToMoodle(page, await interaction.user.id).catch(reason => {
            console.log(reason);
            interaction.editReply({content: reason});
            browser.close();
        })
        let recipientID = await UtilFunctions.NameToID(interaction, page, interaction.options.getString('name-or-id'))
        if (recipientID == null) { 
            await interaction.editReply('Recipient ID could not be found')
            await browser.close(); 
            return;
        };
        await page.goto(`${UtilFunctions.mainStaticUrl}message/index.php?id=${recipientID}`)

        let userHeaderFound = await WaitForUserNameOrError(page)
        // console.log(userHeaderFound)
        if (!userHeaderFound) {
            await interaction.editReply("User Could not be found in messages or you have no access to them")
            await browser.close();
            return;
        }
        
        // await page.waitForSelector('div[data-region="header-content"] strong')
        let recipientName = await page.evaluate(() => document.querySelector('div[data-region="header-content"] strong').textContent);
        let recipientImg = await page.evaluate(() => document.querySelector('div[data-region="header-content"] img').src)

        if (interaction.options.getSubcommand() === 'read') {
            await readMessages(interaction, page, recipientName, recipientImg)
        }
        else if (interaction.options.getSubcommand() === 'send') {
            let cancelSending = await SendComfirmationMessage(interaction, page, recipientName, recipientImg)
            if(cancelSending){
                await interaction.deleteReply(); // just don't send it
            }
            else{
                await SendMessageToUser(interaction, page, recipientName, recipientImg)
            }
        }

        await browser.close();
    }
}

const SendComfirmationMessage = (interaction, page, recipientName, recipientImg) => {
    return new Promise(async (resolve, reject) => {
		const confirmationEmbed = new MessageEmbed()
			.setColor(UtilFunctions.primaryColour)
			.setTitle('Confirmation')
			.setURL(page.url)
            .setThumbnail(recipientImg)
			.setDescription(`Do you want to Message ${recipientName}?\n\nYou have 5 seconds to answer (default is yes)`);
        const confirmationRow = new MessageActionRow()
			.addComponents(
				new MessageButton()
					.setCustomId('No')
					.setLabel('No')
					.setStyle('DANGER'),
		    )
            .addComponents(
                new MessageButton()
                .setCustomId('Yes')
                .setLabel('Yes')
                .setStyle('SUCCESS')
            )
        ;
        
        // const collector = await interaction.channel.createMessageComponentCollector({ time: 3000 });
        let channel = await interaction.channel
        //If the channel isn't inside the guild, you need to create a custom cd channel
        if(!interaction.inGuild()){
            channel = await interaction.user.createDM(); 
        }
        // create collector to handle when button is clicked using the channel
        const collector = await channel.createMessageComponentCollector({ /*filter, */time: 5000 });

        await interaction.editReply({embeds: [confirmationEmbed], components: [confirmationRow]})
        
        collector.on('collect', async i => {
            // console.log(i.customId)
            if(i.customId == 'No'){
                //setting cancel early to true
                resolve(true)
                collector.stop()
                //so it doesn't say sending message
                return;
            }
            else if (i.customId == 'Yes') { 
                await i.update({ content: 'Sending Message', embeds: [], components: []});
                resolve(false)
                await collector.stop()
            }
        });

        collector.on('end', collected => {
            if (collected.size == 0) {
                resolve(false)
            }
        });
    });
}

const WaitForUserNameOrError = (page) => {
    return new Promise((resolve, reject) => {
        page.waitForSelector('div[data-region="header-content"] strong').then(() => { resolve(true); return; }).catch(() => { resolve(false); return; })
        page.waitForSelector('#region-main > div > div.box.errorbox.alert.alert-danger').then(() => { resolve(false); return; }).catch(() => { resolve(false); return; }) //RJECTING cause user not found
    })
}

const readMessages = async (interaction, page, recipientName, recipientImg) => {
    let showReceived = await interaction.options.getBoolean('received') || true; // default values for these
    let showSent = await interaction.options.getBoolean('sent') || false; // default value if null
    
    await page.waitForSelector('div.message', {timeout: 5000}).catch((error) => {/*console.log(error)*/})
    const messages = await page.evaluate((showReceived, showSent, recipientName) => {
        // console.log(showReceived)
        // console.log(showSent)
        let messages = {}
        if(showReceived){
            GetWantedMessages('div.message.received', recipientName);
        } 
        if(showSent){ // that is the user who sent it's name
            senderName = document.querySelector('#usermenu > span').textContent;
            GetWantedMessages('div.message.send', senderName);
        }
        return messages

        function GetWantedMessages(msgSelector, name) {
            let messageDivs = document.querySelectorAll(msgSelector); //div.message.send for user sent messages

            for (const messageDiv of messageDivs) {
                // console.log(messageDiv.querySelectorAll('div[data-region="text-container"] > *'))
                let messageKey = `${name}: ${messageDiv.querySelector('div[data-region="time-created"]').textContent.trim()}`;
                let messageDataArr = Array.from(messageDiv.querySelectorAll('div[data-region="text-container"] > *'), textElem => textElem.textContent.trim()).filter(msgString => msgString != '');
                messages[messageKey] = messages.hasOwnProperty(messageKey) ? messages[messageKey].concat(messageDataArr) : messageDataArr;
            }
        }
    }, showReceived, showSent, recipientName)
    // console.log(messages)
    let messagesReadEmbedArr = [CreateNewMessageReadEmbed(0)];
    //MAX IS 25!!!
    let fieldCounter = 0;
    let currentEmbed = 0; //25 is max messages per embed, and 10 is max embeds. maybe display messages from recent first? using time idk
    if(Object.keys(messages).length > 25 * 10) { await interaction.editReply('There are so many messages there is no point trying!'); return; }
    // console.log(Object.keys(messages).length)
    for (const messageTime of Object.keys(messages)) {
        //They only allow 25 as the max, but as it's zero indexed 25 won't work
        if (fieldCounter == 25) {
            currentEmbed += 1;
            messagesReadEmbedArr.push(CreateNewMessageReadEmbed(currentEmbed));
            fieldCounter = 0;
        }
        if(messages[messageTime].length > 0) messagesReadEmbedArr[currentEmbed].addField(messageTime, messages[messageTime].join("\n"));
        fieldCounter += 1;
    }
    if(Object.keys(messages).length == 0){
        messagesReadEmbedArr[currentEmbed].addField("No Messages Received", "It seems they haven't sent you any messages!")
    }
    await interaction.editReply({embeds: messagesReadEmbedArr})
    return;

    function CreateNewMessageReadEmbed(currentEmbed) {
        // console.log(currentEmbed)
        let title = `Messages With ${recipientName}`
        if (currentEmbed > 0) title += `, Part: ${currentEmbed + 1}`
        return new MessageEmbed()
            .setColor(UtilFunctions.primaryColour)
            .setTitle(title)
            .setURL(page.url)
            .setThumbnail(recipientImg)
            .setDescription('If you don\'t want people seeing this, you can read messages through DMS with this discord bot.');
    }
}

const SendMessageToUser = async (interaction, page, recipientName, recipientImg) => {
    messageText = await interaction.options.getString('message');
    sendAmount = await interaction.options.getInteger('times') || 1;
    // if send amount is greater than 100 then it is just gonna be 100 
    if(sendAmount > 100) sendAmount = 100; //shorthand looked too confusing

    await page.waitForSelector('button[data-action="send-message"]')

    let sentSize = await page.evaluate(() => document.querySelectorAll('div.message.send').length);
    // console.log(sentSize)
    for (let index = 0; index < sendAmount; index++) {
        // textBox.innerText = messageText;
        //TODO getting the elems every time is inefficient
        await page.evaluate((messageText) => {document.querySelector('textarea[data-region="send-message-txt"]').value = messageText}, messageText);
        await page.evaluate(() => document.querySelector('button[data-action="send-message"]').click());

        //Whenever a new message send is loaded into the page
        await page.waitForFunction(
            sentSize => document.querySelectorAll('div.message.send').length > sentSize,
            {},
            sentSize
        );

        sentSize += 1;
    }

    // await page.click('button[data-action="send-message"]')
    let title = `Sent a Message to ${recipientName}`
    if(sendAmount > 1) title += ` ${sendAmount} times!`;

    messageSendEmbed = new MessageEmbed()
    .setColor(UtilFunctions.primaryColour)
    .setTitle(title)
    .setURL(page.url)
    .setThumbnail(recipientImg)
    .setDescription('If you don\'t want people seeing this, you can send the message through DMS with this discord bot.\n You can also read messages with the read subcommand!')
    .addField('Message Text', messageText)
    interaction.editReply({content: ' ', embeds: [messageSendEmbed], components: []})
}